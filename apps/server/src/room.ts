import { createHash, randomBytes, randomInt } from 'node:crypto';
import { BUILTIN_DECKS, DEFAULT_DECKS, combineDecks, type Deck } from '@cirelli/decks';
import {
  createGame,
  nextWakeAt,
  reduce,
  viewFor,
  type ErrorCode,
  type GameConfig,
  type GameState,
  type Input,
  type SeatId,
} from '@cirelli/engine';
import type {
  ClientMessage,
  DeckSummary,
  Intent,
  ServerErrorCode,
  ServerMessage,
} from '@cirelli/protocol';
import type { RoomSnapshot, Store } from './store.ts';

/** Una connessione WebSocket vista dalla stanza: basta poter mandare e chiudere. */
export interface Conn {
  send(msg: ServerMessage): void;
  close(code?: number, reason?: string): void;
  seat: SeatId | null;
  role: 'player' | 'screen' | null;
}

export interface RoomDeps {
  store: Store;
  now: () => number;
  resolveDeck: (code: string) => Promise<Deck | null>;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export class Room {
  state: GameState;
  rev = 0;
  seats = new Map<string, SeatId>();
  banned = new Set<string>();
  decks: string[] = [...DEFAULT_DECKS];
  deckSummaries: DeckSummary[] = [];
  conns = new Set<Conn>();
  createdAt: number;
  lastActivity: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    readonly code: string,
    private deps: RoomDeps,
    timings: Partial<GameConfig> = {},
    snapshot?: RoomSnapshot,
  ) {
    const now = deps.now();
    if (snapshot) {
      this.state = snapshot.state;
      this.rev = snapshot.rev;
      this.seats = new Map(Object.entries(snapshot.seats));
      this.banned = new Set(snapshot.banned);
      this.decks = snapshot.decks;
      this.createdAt = snapshot.createdAt;
    } else {
      this.state = createGame(randomInt(2 ** 31), timings);
      this.createdAt = now;
    }
    this.lastActivity = now;
    this.deckSummaries = this.decks.map((c) => {
      const builtin = BUILTIN_DECKS[c];
      return builtin ? summary(c, builtin) : { code: c, name: c, black: 0, white: 0 };
    });
  }

  /** Dopo un riavvio nessuno è davvero connesso: partono le tolleranze. */
  markAllDisconnected(): void {
    for (const p of this.state.players) {
      if (p.kind === 'human' && p.connected)
        this.apply({ type: 'disconnect', seat: p.id, now: this.deps.now() });
    }
    this.schedule();
  }

  async handle(conn: Conn, msg: ClientMessage): Promise<void> {
    this.lastActivity = this.deps.now();
    switch (msg.t) {
      case 'ping':
        conn.send({ t: 'pong', at: msg.at, serverNow: this.deps.now() });
        return;
      case 'hello':
        return this.hello(conn, msg);
      case 'intent':
        return this.intent(conn, msg.seq, msg.intent);
    }
  }

  private async hello(conn: Conn, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<void> {
    if (conn.role) return; // già presentato
    if (msg.role === 'screen') {
      conn.role = 'screen';
      conn.seat = null;
      this.conns.add(conn);
      conn.send({
        t: 'welcome',
        room: this.code,
        seat: null,
        token: null,
        serverNow: this.deps.now(),
      });
      this.sendState(conn);
      return;
    }

    const tokenHash = msg.token ? hashToken(msg.token) : null;
    if (tokenHash && this.banned.has(tokenHash)) return this.refuse(conn, 'KICKED');

    const known = tokenHash ? this.seats.get(tokenHash) : undefined;
    if (known && this.state.players.some((p) => p.id === known)) {
      conn.role = 'player';
      conn.seat = known;
      this.conns.add(conn);
      conn.send({
        t: 'welcome',
        room: this.code,
        seat: known,
        token: msg.token ?? null,
        serverNow: this.deps.now(),
      });
      const res = this.apply({ type: 'connect', seat: known, now: this.deps.now() });
      if (!res) this.sendState(conn);
      return;
    }

    if (!msg.name) return this.refuse(conn, msg.token ? 'BAD_TOKEN' : 'NAME_REQUIRED');

    const seat = 's' + randomBytes(6).toString('base64url');
    const token = newToken();
    const res = reduce(this.state, { type: 'join', seat, name: msg.name, now: this.deps.now() });
    if (!res.ok) return this.refuse(conn, res.error);

    this.seats.set(hashToken(token), seat);
    conn.role = 'player';
    conn.seat = seat;
    this.conns.add(conn);
    conn.send({ t: 'welcome', room: this.code, seat, token, serverNow: this.deps.now() });
    this.commit(res.state, res.events);

    // Il primo host carica i mazzi predefiniti, così si può iniziare subito.
    if (this.state.hostId === seat && Object.keys(this.state.cards.black).length === 0) {
      await this.loadDecks(seat, this.decks);
    }
  }

  private refuse(conn: Conn, code: ServerErrorCode | ErrorCode): void {
    conn.send({ t: 'error', code, message: code });
    conn.close(4000, code);
  }

  private async intent(conn: Conn, seq: number, intent: Intent): Promise<void> {
    const seat = conn.seat;
    if (!seat) {
      conn.send({ t: 'ack', seq, ok: false, error: 'NOT_JOINED' });
      return;
    }
    let error: ErrorCode | ServerErrorCode | null;
    if (intent.type === 'leave') {
      // Chi esce riceve la conferma prima che la sua connessione venga chiusa.
      const res = reduce(this.state, { type: 'leave', by: seat, now: this.deps.now() });
      conn.send(
        res.ok ? { t: 'ack', seq, ok: true } : { t: 'ack', seq, ok: false, error: res.error },
      );
      if (res.ok) this.commit(res.state, res.events);
      return;
    }
    if (intent.type === 'setDecks') {
      error = await this.loadDecks(seat, intent.decks);
    } else {
      const res = reduce(this.state, { ...intent, by: seat, now: this.deps.now() } as Input);
      if (res.ok) {
        this.commit(res.state, res.events);
        error = null;
      } else {
        error = res.error;
      }
    }
    conn.send(error ? { t: 'ack', seq, ok: false, error } : { t: 'ack', seq, ok: true });
  }

  private async loadDecks(
    by: SeatId,
    codes: string[],
  ): Promise<ErrorCode | ServerErrorCode | null> {
    if (this.state.hostId !== by) return 'NOT_HOST';
    if (this.state.phase !== 'lobby') return 'WRONG_PHASE';
    const unique = [...new Set(codes)];
    const decks: Deck[] = [];
    for (const code of unique) {
      const deck =
        BUILTIN_DECKS[code] ??
        (/^[A-Z0-9]{6}$/.test(code) ? await this.deps.resolveDeck(code) : null);
      if (!deck) return 'DECK_NOT_FOUND';
      decks.push(deck);
    }
    const cards = combineDecks(decks);
    const res = reduce(this.state, { type: 'loadCards', by, ...cards, now: this.deps.now() });
    if (!res.ok) return res.error;
    this.decks = unique;
    this.deckSummaries = unique.map((c, i) => summary(c, decks[i] as Deck));
    this.commit(res.state, res.events);
    return null;
  }

  /** Applica un input di sistema; restituisce true se lo stato è cambiato. */
  apply(input: Input): boolean {
    const res = reduce(this.state, input);
    if (!res.ok) return false;
    this.commit(res.state, res.events);
    return true;
  }

  private commit(
    state: GameState,
    events: { type: string; seat?: string; kicked?: boolean }[],
  ): void {
    this.state = state;
    this.rev += 1;
    for (const e of events) {
      if (e.type === 'playerLeft' && e.seat) this.dropSeat(e.seat, e.kicked === true);
    }
    this.persist();
    this.broadcast();
    this.schedule();
  }

  private dropSeat(seat: SeatId, kicked: boolean): void {
    for (const [hash, s] of this.seats) {
      if (s !== seat) continue;
      this.seats.delete(hash);
      if (kicked) this.banned.add(hash);
    }
    for (const conn of this.conns) {
      if (conn.seat !== seat) continue;
      this.conns.delete(conn);
      if (kicked) conn.send({ t: 'error', code: 'KICKED', message: 'KICKED' });
      conn.close(4001, kicked ? 'KICKED' : 'LEFT');
    }
  }

  /** Una connessione si chiude: se era l'ultima di quel posto, il giocatore risulta disconnesso. */
  detach(conn: Conn): void {
    if (!this.conns.delete(conn)) return;
    this.lastActivity = this.deps.now();
    const seat = conn.seat;
    if (!seat) return;
    const stillHere = [...this.conns].some((c) => c.seat === seat);
    const player = this.state.players.find((p) => p.id === seat);
    if (!stillHere && player?.connected) {
      this.apply({ type: 'disconnect', seat, now: this.deps.now() });
    }
  }

  private sendState(conn: Conn): void {
    conn.send({
      t: 'state',
      rev: this.rev,
      view: viewFor(this.state, conn.seat),
      room: { code: this.code, decks: this.deckSummaries, available: AVAILABLE },
    });
  }

  private broadcast(): void {
    for (const conn of this.conns) this.sendState(conn);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.deps.now();
    const at = nextWakeAt(this.state, now);
    if (at === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (!this.apply({ type: 'tick', now: this.deps.now() })) this.schedule();
      },
      Math.max(0, at - now) + 5,
    );
    this.timer.unref?.();
  }

  snapshot(): RoomSnapshot {
    return {
      code: this.code,
      state: this.state,
      rev: this.rev,
      seats: Object.fromEntries(this.seats),
      banned: [...this.banned],
      decks: this.decks,
      createdAt: this.createdAt,
      updatedAt: this.deps.now(),
    };
  }

  private persist(): void {
    const snap = this.snapshot();
    this.saving = this.saving
      .then(() => this.deps.store.saveRoom(snap))
      .catch((e: unknown) => console.error(`salvataggio stanza ${this.code} fallito`, e));
  }

  async flush(): Promise<void> {
    await this.saving;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const conn of this.conns) conn.close(1001, 'ROOM_CLOSED');
    this.conns.clear();
  }

  get isEmpty(): boolean {
    return this.conns.size === 0;
  }
}

const AVAILABLE: DeckSummary[] = Object.entries(BUILTIN_DECKS).map(([id, deck]) =>
  summary(id, deck),
);

function summary(code: string, deck: Deck): DeckSummary {
  return { code, name: deck.name, black: deck.black.length, white: deck.white.length };
}
