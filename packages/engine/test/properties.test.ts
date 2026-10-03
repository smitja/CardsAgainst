import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createGame,
  reduce,
  viewFor,
  type GameConfig,
  type GameState,
  type Input,
  type PickCount,
} from '../src/index.ts';
import { assertConservation, makeBlack, makeWhite } from './helpers.ts';

/**
 * Pilota casuale: a ogni passo costruisce le mosse possibili (sensate e non) e ne sceglie una
 * con l'indice generato da fast-check. Dopo ogni passo controlla gli invarianti.
 */
function candidates(s: GameState, now: number, step: number): Input[] {
  const out: Input[] = [];
  const humans = s.players.filter((p) => p.kind === 'human');
  const host = s.hostId ?? 'nessuno';
  const any = humans[step % Math.max(1, humans.length)]?.id ?? 'nessuno';

  out.push({ type: 'tick', now: now + (step % 3 === 0 ? 25_000 : 500) });
  if (humans.length < 10) out.push({ type: 'join', seat: `x${step}`, name: `Ospite ${step}`, now });
  for (const p of humans) {
    out.push({ type: p.connected ? 'disconnect' : 'connect', seat: p.id, now });
  }
  out.push({ type: 'start', by: host, now });
  out.push({ type: 'rematch', by: host, now });
  out.push({ type: 'nextRound', by: host, now });
  out.push({ type: 'kick', by: host, target: any, now });
  out.push({ type: 'leave', by: any, now });
  out.push({ type: 'transferHost', by: host, to: any, now });
  out.push({ type: 'setConfig', by: host, config: { targetScore: 1 + (step % 4) }, now });

  const r = s.round;
  if (r) {
    const pick = s.cards.black[r.black]?.pick ?? 1;
    for (const id of r.participants) {
      const p = s.players.find((x) => x.id === id);
      if (!p) continue;
      const cards = p.hand.slice(0, pick);
      const blankTexts = Object.fromEntries(cards.map((c) => [c, `JOLLY-${id}-${step}`]));
      // La mossa giusta compare più volte: le partite devono anche andare avanti.
      out.push({ type: 'play', by: id, cards, blankTexts, now });
      out.push({ type: 'play', by: id, cards, blankTexts, now });
      out.push({ type: 'play', by: id, cards: p.hand.slice(1, 1 + pick), now });
      out.push({ type: 'retract', by: id, now });
      out.push({ type: 'swapHand', by: id, now });
    }
    const revealer = r.judge ?? any;
    out.push({ type: 'reveal', by: revealer, index: r.revealed, now });
    out.push({ type: 'reveal', by: revealer, index: r.revealed, now });
    out.push({ type: 'reveal', by: any, index: r.revealed + 1, now });
    const subs = r.submissions;
    if (subs.length) {
      const sub = subs[step % subs.length];
      out.push({ type: 'pick', by: r.judge ?? any, submission: sub?.id ?? '', now });
      out.push({ type: 'pick', by: r.judge ?? any, submission: sub?.id ?? '', now });
      for (const p of humans) out.push({ type: 'vote', by: p.id, submission: sub?.id ?? '', now });
    }
    out.push({ type: 'nextRound', by: r.judge ?? host, now });
  }
  return out;
}

function checkInvariants(s: GameState): void {
  assertConservation(s);
  const humans = s.players.filter((p) => p.kind === 'human');
  expect(humans.length).toBeLessThanOrEqual(10);
  for (const p of s.players) {
    expect(p.score).toBeGreaterThanOrEqual(0);
    expect(p.hand.length).toBeLessThanOrEqual(s.config.handSize);
  }
  if (s.hostId !== null) expect(humans.some((p) => p.id === s.hostId)).toBe(true);
  const r = s.round;
  if (r) {
    if (r.judge) expect(r.participants).not.toContain(r.judge);
    const authors = r.submissions.map((x) => x.by);
    expect(new Set(authors).size).toBe(authors.length);
    if (s.phase !== 'result') for (const a of authors) expect(r.participants).toContain(a);
    expect(r.revealed).toBeLessThanOrEqual(r.order.length);
    for (const sub of r.submissions) {
      expect(sub.cards).toHaveLength(s.cards.black[r.black]?.pick as number);
    }
  }
  checkNoLeaks(s);
}

/** Nessuna vista contiene carte altrui, risposte non ancora svelate o autori anonimi. */
function checkNoLeaks(s: GameState): void {
  const r = s.round;
  const viewers = [...s.players.filter((p) => p.kind === 'human').map((p) => p.id), null];
  for (const seat of viewers) {
    const v = viewFor(s, seat);
    const json = JSON.stringify(v);
    for (const p of s.players) {
      if (p.id === seat) continue;
      for (const id of p.hand) {
        const text = s.cards.white[id]?.text;
        if (text) expect(json).not.toContain(text);
      }
    }
    if (!r) continue;
    const visible =
      s.phase === 'revealing'
        ? new Set(r.order.slice(0, r.revealed))
        : s.phase === 'judging' || s.phase === 'result' || s.phase === 'ended'
          ? new Set(r.order)
          : new Set<string>();
    for (const sub of r.submissions) {
      if (visible.has(sub.id) || sub.by === seat) continue;
      for (const t of sub.texts) expect(json).not.toContain(t);
    }
    for (const sub of v.round?.submissions ?? []) {
      if (sub.author !== null) {
        expect(s.phase).toBe('result');
        expect(sub.winner).toBe(true);
      }
    }
  }
}

const configArb = fc.record<Partial<GameConfig>>({
  ghost: fc.boolean(),
  voting: fc.boolean(),
  handSwap: fc.boolean(),
  blankCards: fc.constantFrom(0, 0, 4),
  choosingSeconds: fc.constantFrom(null, 30),
  judgingSeconds: fc.constantFrom(null, 20),
  dealMs: fc.constantFrom(0, 1000),
  resultMs: fc.constantFrom(null, 5000),
  targetScore: fc.integer({ min: 1, max: 4 }),
});

function setup(seed: number, players: number, config: Partial<GameConfig>, whiteCount: number) {
  let s = createGame(seed, config);
  let now = 1000;
  const run = (input: Input) => {
    const res = reduce(s, input);
    if (res.ok) s = res.state;
    return res;
  };
  for (let i = 1; i <= players; i++)
    run({ type: 'join', seat: `p${i}`, name: `P${i}`, now: now++ });
  run({
    type: 'loadCards',
    by: 'p1',
    black: makeBlack(12, [1, 2, 3, 1] as PickCount[]),
    white: makeWhite(whiteCount),
    now: now++,
  });
  run({ type: 'start', by: 'p1', now: now++ });
  return { get: () => s, run, now: () => now, advance: (ms: number) => (now += ms) };
}

function playOut(
  seed: number,
  players: number,
  config: Partial<GameConfig>,
  moves: number[],
  check = true,
) {
  const g = setup(seed, players, config, 90);
  const trace: Input[] = [];
  moves.forEach((m, step) => {
    const before = g.get();
    const options = candidates(before, g.now(), step);
    const input = options[m % options.length] as Input;
    trace.push(input);
    const res = g.run(input);
    if (!res.ok) expect(res.state).toBe(before);
    if (input.type === 'tick') g.advance(input.now - g.now());
    g.advance(1);
    if (check) checkInvariants(g.get());
  });
  return { state: g.get(), trace };
}

describe('proprietà del motore', () => {
  it('invarianti in partite casuali: carte conservate, nessuna fuga di informazioni', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.integer({ min: 3, max: 6 }),
        configArb,
        fc.array(fc.nat(), { minLength: 20, maxLength: 160 }),
        (seed, players, config, moves) => {
          playOut(seed, players, config, moves);
        },
      ),
      { numRuns: 150 },
    );
  }, 180_000);

  it('determinismo: stesso seme e stessi input danno lo stesso stato', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        configArb,
        fc.array(fc.nat(), { minLength: 10, maxLength: 80 }),
        (seed, config, moves) => {
          const a = playOut(seed, 4, config, moves, false);
          const b = playOut(seed, 4, config, moves, false);
          expect(b.trace).toEqual(a.trace);
          expect(b.state).toEqual(a.state);
        },
      ),
      { numRuns: 60 },
    );
  }, 60_000);

  it('rotazione equa: in 2N round ognuno giudica due volte', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.integer({ min: 3, max: 8 }),
        (seed, n) => {
          const g = setup(seed, n, { dealMs: 0, resultMs: null, targetScore: 50 }, 200);
          const count = new Map<string, number>();
          for (let round = 0; round < 2 * n; round++) {
            const s = g.get();
            const r = s.round;
            if (!r?.judge) throw new Error('round senza giudice');
            count.set(r.judge, (count.get(r.judge) ?? 0) + 1);
            for (const id of r.participants) {
              const p = s.players.find((x) => x.id === id);
              const pick = s.cards.black[r.black]?.pick ?? 1;
              g.run({
                type: 'play',
                by: id,
                cards: p?.hand.slice(0, pick) ?? [],
                now: g.advance(1),
              });
            }
            for (let i = 0; i < r.participants.length; i++) {
              g.run({ type: 'reveal', by: r.judge, index: i, now: g.advance(1) });
            }
            const sid = g.get().round?.order[0] as string;
            expect(
              g.run({ type: 'pick', by: r.judge, submission: sid, now: g.advance(1) }).ok,
            ).toBe(true);
            expect(g.run({ type: 'nextRound', by: r.judge, now: g.advance(1) }).ok).toBe(true);
          }
          expect(count.size).toBe(n);
          for (const c of count.values()) expect(c).toBe(2);
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);
});
