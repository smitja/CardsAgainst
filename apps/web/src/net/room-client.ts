import type { GameView } from '@cirelli/engine';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type Intent,
  type RoomInfo,
  type ServerMessage,
} from '@cirelli/protocol/client';
import { storage } from '../lib/storage.ts';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** Errori che chiudono la sessione: non ha senso riconnettersi. */
export type FatalError =
  | 'ROOM_NOT_FOUND'
  | 'KICKED'
  | 'NAME_REQUIRED'
  | 'BAD_TOKEN'
  | 'ROOM_FULL'
  | 'BAD_NAME'
  | 'VERSION'
  | 'LEFT';

export interface RoomSnapshot {
  status: ConnectionStatus;
  view: GameView | null;
  room: RoomInfo | null;
  seat: string | null;
  fatal: FatalError | null;
  /** Ultimo errore di un'azione (non fatale), per un avviso breve. */
  notice: { code: string; at: number } | null;
  /** Differenza fra orologio del server e del telefono. */
  clockOffset: number;
  pending: number;
}

const tokenKey = (code: string) => `cac:token:${code}`;
const NAME_KEY = 'cac:name';

export const savedName = () => storage.get(NAME_KEY) ?? '';
export const hasToken = (code: string) => storage.get(tokenKey(code)) !== null;

const FATAL = new Set<string>([
  'ROOM_NOT_FOUND',
  'KICKED',
  'NAME_REQUIRED',
  'BAD_TOKEN',
  'ROOM_FULL',
  'BAD_NAME',
  'VERSION',
]);

/**
 * Connessione a una stanza: riconnessione automatica con attesa crescente, coda delle azioni
 * mentre la rete manca, e sincronizzazione dell'orologio per i timer.
 */
export class RoomClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<() => void>();
  private seq = 0;
  private queue = new Map<number, Intent>();
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private lastRev = -1;
  snapshot: RoomSnapshot = {
    status: 'connecting',
    view: null,
    room: null,
    seat: null,
    fatal: null,
    notice: null,
    clockOffset: 0,
    pending: 0,
  };

  constructor(
    readonly code: string,
    private opts: { role: 'player' | 'screen'; name?: string },
  ) {
    if (opts.name) storage.set(NAME_KEY, opts.name);
    window.addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    this.open();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<RoomSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch, pending: this.queue.size };
    for (const fn of this.listeners) fn();
  }

  private url() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      const token = storage.get(tokenKey(this.code)) ?? undefined;
      this.raw({
        t: 'hello',
        v: PROTOCOL_VERSION,
        room: this.code,
        role: this.opts.role,
        ...(token ? { token } : {}),
        ...(this.opts.name ? { name: this.opts.name } : {}),
      });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.stopped || this.snapshot.fatal) {
        this.set({ status: 'closed' });
        return;
      }
      this.set({ status: 'reconnecting' });
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const base = Math.min(8000, 500 * 2 ** this.attempt);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.open(), base / 2 + Math.random() * (base / 2));
  }

  /** Torna in primo piano o torna la rete: riprova subito. */
  private wake = () => {
    if (document.visibilityState !== 'visible' || this.stopped || this.snapshot.fatal) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.attempt = 0;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.open();
    }
  };

  private receive(msg: ServerMessage) {
    switch (msg.t) {
      case 'welcome': {
        this.attempt = 0;
        if (msg.token) storage.set(tokenKey(this.code), msg.token);
        this.lastRev = -1;
        this.set({ status: 'open', seat: msg.seat, clockOffset: msg.serverNow - Date.now() });
        // Le azioni rimaste in coda ripartono: il motore ignora i doppioni.
        for (const [seq, intent] of this.queue) this.raw({ t: 'intent', seq, intent });
        this.startPing();
        return;
      }
      case 'state':
        if (msg.rev < this.lastRev) return;
        this.lastRev = msg.rev;
        this.set({ view: msg.view, room: msg.room });
        return;
      case 'ack':
        this.queue.delete(msg.seq);
        this.set(msg.ok ? {} : { notice: { code: msg.error, at: Date.now() } });
        return;
      case 'pong': {
        const now = Date.now();
        this.set({ clockOffset: msg.serverNow - (msg.at + now) / 2 });
        return;
      }
      case 'error':
        if (FATAL.has(msg.code)) {
          if (msg.code === 'BAD_TOKEN' || msg.code === 'KICKED')
            storage.remove(tokenKey(this.code));
          this.set({ fatal: msg.code as FatalError, status: 'closed' });
        } else {
          this.set({ notice: { code: msg.code, at: Date.now() } });
        }
        return;
    }
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const ping = () => this.raw({ t: 'ping', at: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 20_000);
  }

  private raw(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  send(intent: Intent) {
    const seq = ++this.seq;
    this.queue.set(seq, intent);
    this.set({});
    if (this.snapshot.status === 'open') this.raw({ t: 'intent', seq, intent });
  }

  /** Esce dalla stanza: libera il posto e dimentica il token. */
  leave() {
    this.send({ type: 'leave' });
    storage.remove(tokenKey(this.code));
    this.set({ fatal: 'LEFT' });
    setTimeout(() => this.dispose(), 300);
  }

  dispose() {
    this.stopped = true;
    window.removeEventListener('online', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
