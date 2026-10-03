import { expect } from 'vitest';
import {
  createGame,
  reduce,
  type BlackCard,
  type GameConfig,
  type GameState,
  type Input,
  type PickCount,
  type Player,
  type Round,
  type WhiteCard,
} from '../src/index.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type InputNoTime = DistributiveOmit<Input, 'now'>;

/** Orologio finto condiviso dai test: ogni input avanza di 1 ms. */
export class Clock {
  constructor(public now = 1_000_000) {}
  advance(ms: number) {
    this.now += ms;
    return this.now;
  }
}

export function makeBlack(n: number, picks: PickCount[] = [1]): BlackCard[] {
  return Array.from({ length: n }, (_, i) => {
    const pick = picks[i % picks.length] as PickCount;
    return { id: `b${i + 1}`, text: `Nera ${i + 1} ${'___ '.repeat(pick)}`.trim(), pick };
  });
}

export function makeWhite(n: number): WhiteCard[] {
  return Array.from({ length: n }, (_, i) => ({ id: `w${i + 1}`, text: `[W${i + 1}]` }));
}

export const TEST_CONFIG: Partial<GameConfig> = { dealMs: 0, resultMs: null };

export class Game {
  state: GameState;
  clock = new Clock();
  events: string[] = [];

  constructor(seed = 42, config: Partial<GameConfig> = {}) {
    this.state = createGame(seed, { ...TEST_CONFIG, ...config });
  }

  /** Applica un input che deve riuscire. */
  do(input: InputNoTime): this {
    const res = reduce(this.state, { ...input, now: this.clock.advance(1) } as Input);
    if (!res.ok) throw new Error(`atteso ok per ${input.type}, errore ${res.error}`);
    this.state = res.state;
    this.events.push(...res.events.map((e) => e.type));
    return this;
  }

  /** Applica un input che deve fallire; restituisce il codice e verifica che lo stato non cambi. */
  err(input: InputNoTime): string {
    const before = this.state;
    const res = reduce(this.state, { ...input, now: this.clock.advance(1) } as Input);
    expect(res.ok).toBe(false);
    expect(res.state).toBe(before);
    return res.ok ? '' : res.error;
  }

  tick(ms: number): this {
    this.clock.advance(ms - 1);
    return this.do({ type: 'tick' });
  }

  get round(): Round {
    const r = this.state.round;
    if (!r) throw new Error('nessun round');
    return r;
  }

  get host(): string {
    return this.state.hostId as string;
  }

  get judge(): string {
    return this.round.judge as string;
  }

  player(id: string): Player {
    const p = this.state.players.find((x) => x.id === id);
    if (!p) throw new Error(`giocatore ${id} assente`);
    return p;
  }

  pickCount(): number {
    return (this.state.cards.black[this.round.black] as BlackCard).pick;
  }

  /** Tutti i partecipanti che non hanno ancora giocato giocano le prime carte della mano. */
  playAll(except: string[] = []): this {
    for (const id of [...this.round.participants]) {
      if (except.includes(id) || this.round.submissions.some((s) => s.by === id)) continue;
      if (this.state.phase !== 'choosing') break;
      this.playFor(id);
    }
    return this;
  }

  playFor(id: string): this {
    const p = this.player(id);
    const cards = p.hand.slice(0, this.pickCount());
    const blankTexts = Object.fromEntries(cards.map((c) => [c, `scritta di ${id}`]));
    return this.do({ type: 'play', by: id, cards, blankTexts });
  }

  revealAll(by = this.judge): this {
    while (this.state.phase === 'revealing') {
      this.do({ type: 'reveal', by, index: this.round.revealed });
    }
    return this;
  }

  /** Round completo: tutti giocano, il giudice svela e premia la prima risposta in ordine. */
  playRound(): string {
    this.playAll().revealAll();
    const sid = this.round.order[0] as string;
    const winner = this.round.submissions.find((s) => s.id === sid)?.by as string;
    this.do({ type: 'pick', by: this.judge, submission: sid });
    return winner;
  }
}

/** Partita in lobby con n giocatori (p1..pn), mazzo caricato. */
export function lobby(
  n: number,
  opts: {
    seed?: number;
    config?: Partial<GameConfig>;
    black?: BlackCard[];
    white?: WhiteCard[];
  } = {},
): Game {
  const g = new Game(opts.seed ?? 42, opts.config);
  for (let i = 1; i <= n; i++) g.do({ type: 'join', seat: `p${i}`, name: `Giocatore ${i}` });
  g.do({
    type: 'loadCards',
    by: 'p1',
    black: opts.black ?? makeBlack(20),
    white: opts.white ?? makeWhite(120),
  });
  return g;
}

export function started(n: number, opts: Parameters<typeof lobby>[1] = {}): Game {
  return lobby(n, opts).do({ type: 'start', by: 'p1' });
}

/** Ogni carta compare esattamente una volta fra mazzi, scarti, mani e tavolo. */
export function assertConservation(state: GameState): void {
  if (state.phase === 'lobby') return;
  const white: string[] = [
    ...state.piles.whiteDraw,
    ...state.piles.whiteDiscard,
    ...state.players.flatMap((p) => p.hand),
    ...(state.round?.submissions.flatMap((s) => s.cards) ?? []),
  ];
  expect(white.length).toBe(new Set(white).size);
  expect([...white].sort()).toEqual(Object.keys(state.cards.white).sort());
  const black: string[] = [
    ...state.piles.blackDraw,
    ...state.piles.blackDiscard,
    ...(state.round ? [state.round.black] : []),
  ];
  expect(black.length).toBe(new Set(black).size);
  expect([...black].sort()).toEqual(Object.keys(state.cards.black).sort());
}
