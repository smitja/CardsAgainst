import { describe, expect, it } from 'vitest';
import { assertConservation, lobby, makeBlack, makeWhite, started } from './helpers.ts';

describe('scelta', () => {
  it('ogni partecipante gioca quante carte chiede la nera', () => {
    const g = started(4);
    const [a] = g.round.participants as [string];
    const hand = [...g.player(a).hand];
    expect(g.err({ type: 'play', by: a, cards: [] })).toBe('BAD_CARDS');
    expect(g.err({ type: 'play', by: a, cards: hand.slice(0, 2) })).toBe('BAD_CARDS');
    expect(g.err({ type: 'play', by: a, cards: ['nessuna'] })).toBe('BAD_CARDS');
    expect(g.err({ type: 'play', by: a, cards: 'w1' as never })).toBe('BAD_CARDS');
    g.do({ type: 'play', by: a, cards: [hand[0] as string] });
    expect(g.player(a).hand).toHaveLength(9);
    expect(g.err({ type: 'play', by: a, cards: [hand[1] as string] })).toBe('ALREADY_PLAYED');
    assertConservation(g.state);
  });

  it('il giudice non gioca', () => {
    const g = started(3);
    const hand = g.player(g.judge).hand;
    expect(g.err({ type: 'play', by: g.judge, cards: [hand[0] as string] })).toBe(
      'NOT_PARTICIPANT',
    );
  });

  it('con più spazi conta l’ordine delle carte', () => {
    const g = started(3, { black: makeBlack(10, [3]) });
    const [a] = g.round.participants as [string];
    const hand = g.player(a).hand;
    const chosen = [hand[2], hand[0], hand[1]] as string[];
    expect(
      g.err({ type: 'play', by: a, cards: [chosen[0], chosen[0], chosen[1]] as string[] }),
    ).toBe('BAD_CARDS');
    g.do({ type: 'play', by: a, cards: chosen });
    const sub = g.round.submissions[0];
    expect(sub?.cards).toEqual(chosen);
    expect(sub?.texts).toEqual(chosen.map((id) => g.state.cards.white[id]?.text));
  });

  it('si può ritirare la giocata finché la fase è aperta', () => {
    const g = started(4);
    const [a] = g.round.participants as [string];
    expect(g.err({ type: 'retract', by: a })).toBe('NOT_PLAYED');
    const card = g.player(a).hand[0] as string;
    g.do({ type: 'play', by: a, cards: [card] });
    g.do({ type: 'retract', by: a });
    expect(g.player(a).hand).toContain(card);
    expect(g.round.submissions).toHaveLength(0);
    expect(g.events).toContain('retracted');
  });

  it('quando tutti hanno giocato si passa alla rivelazione con ordine mescolato', () => {
    const g = started(5);
    g.playAll();
    expect(g.state.phase).toBe('revealing');
    expect(g.round.order).toHaveLength(4);
    expect([...g.round.order].sort()).toEqual(g.round.submissions.map((s) => s.id).sort());
    expect(g.err({ type: 'retract', by: g.round.participants[0] as string })).toBe('WRONG_PHASE');
  });

  it('chi non è in partita non gioca', () => {
    const g = started(3);
    expect(g.err({ type: 'play', by: 'sconosciuto', cards: ['w1'] })).toBe('NOT_PARTICIPANT');
    expect(g.err({ type: 'reveal', by: g.judge, index: 0 })).toBe('WRONG_PHASE');
  });
});

describe('rivelazione', () => {
  it('svela solo il giudice, una alla volta, e un doppio tap non fa danni', () => {
    const g = started(4);
    g.playAll();
    const other = g.round.participants[0] as string;
    expect(g.err({ type: 'reveal', by: other, index: 0 })).toBe('NOT_ALLOWED');
    expect(g.err({ type: 'reveal', by: g.judge, index: 1 })).toBe('BAD_INDEX');
    expect(g.err({ type: 'reveal', by: g.judge, index: -1 })).toBe('BAD_INDEX');
    g.do({ type: 'reveal', by: g.judge, index: 0 });
    g.do({ type: 'reveal', by: g.judge, index: 0 });
    expect(g.round.revealed).toBe(1);
    g.do({ type: 'reveal', by: g.judge, index: 1 });
    g.do({ type: 'reveal', by: g.judge, index: 2 });
    expect(g.state.phase).toBe('judging');
    expect(g.events.filter((e) => e === 'revealed')).toHaveLength(3);
  });
});

describe('giudizio e risultato', () => {
  it('il giudice sceglie la vincitrice, che prende un punto', () => {
    const g = started(4);
    g.playAll().revealAll();
    const sid = g.round.order[1] as string;
    const author = g.round.submissions.find((s) => s.id === sid)?.by as string;
    expect(g.err({ type: 'pick', by: author, submission: sid })).toBe('NOT_ALLOWED');
    expect(g.err({ type: 'pick', by: g.judge, submission: 'boh' })).toBe('UNKNOWN_SUBMISSION');
    expect(g.err({ type: 'vote', by: author, submission: sid })).toBe('NOT_ALLOWED');
    g.do({ type: 'pick', by: g.judge, submission: sid });
    expect(g.state.phase).toBe('result');
    expect(g.player(author).score).toBe(1);
    expect(g.round.winners).toEqual([author]);
    expect(g.round.outcome).toBe('won');
    expect(g.state.roundsPlayed).toBe(1);
  });

  it('al round successivo le mani tornano a dieci e il giudice ruota', () => {
    const g = started(4);
    const firstJudge = g.judge;
    g.playRound();
    expect(
      g.err({ type: 'nextRound', by: g.round.participants.find((p) => p !== 'p1') ?? 'x' }),
    ).toBe('NOT_ALLOWED');
    g.do({ type: 'nextRound', by: g.judge });
    expect(g.state.phase).toBe('choosing');
    expect(g.judge).not.toBe(firstJudge);
    for (const p of g.state.players) expect(p.hand).toHaveLength(10);
    expect(g.state.piles.whiteDiscard).toHaveLength(3);
    expect(g.state.piles.blackDiscard).toHaveLength(1);
    assertConservation(g.state);
  });

  it('il giudice ruota in ordine d’ingresso', () => {
    const g = started(4);
    const order = ['p1', 'p2', 'p3', 'p4'];
    const seen = [g.judge];
    for (let i = 0; i < 7; i++) {
      g.playRound();
      g.do({ type: 'nextRound', by: 'p1' });
      seen.push(g.judge);
    }
    const start = order.indexOf(seen[0] as string);
    expect(seen).toEqual(seen.map((_, i) => order[(start + i) % 4]));
  });

  it('con resultMs il risultato avanza da solo', () => {
    const g = started(3, { config: { resultMs: 5000 } });
    g.playRound();
    g.tick(4999);
    expect(g.state.phase).toBe('result');
    g.tick(1);
    expect(g.state.phase).toBe('choosing');
  });
});

describe('fine partita', () => {
  it('vince chi arriva al punteggio obiettivo', () => {
    const g = started(3, { config: { targetScore: 2 } });
    let ended = false;
    for (let i = 0; i < 20 && !ended; i++) {
      g.playRound();
      g.do({ type: 'nextRound', by: 'p1' });
      ended = g.state.phase === 'ended';
    }
    expect(ended).toBe(true);
    expect(g.state.endReason).toBe('target');
    const top = Math.max(...g.state.players.map((p) => p.score));
    expect(top).toBe(2);
    expect(g.state.winners).toEqual(g.state.players.filter((p) => p.score === 2).map((p) => p.id));
    expect(g.events).toContain('gameEnded');
    assertConservation(g.state);
  });

  it('al limite di round vince chi è in testa, anche a pari merito', () => {
    const g = started(3, { config: { maxRounds: 2, targetScore: 10 } });
    const w1 = g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    let w2 = '';
    // Il secondo round lo vince qualcun altro, se possibile, per avere un pari merito.
    g.playAll().revealAll();
    const other = g.round.submissions.find((s) => s.by !== w1) ?? g.round.submissions[0];
    w2 = other?.by as string;
    g.do({ type: 'pick', by: g.judge, submission: other?.id as string });
    g.do({ type: 'nextRound', by: 'p1' });
    expect(g.state.phase).toBe('ended');
    expect(g.state.endReason).toBe('rounds');
    expect([...g.state.winners].sort()).toEqual([...new Set([w1, w2])].sort());
  });

  it('nessun vincitore se nessuno ha punti', () => {
    const g = started(3, { config: { maxRounds: 1, judgingSeconds: 10 } });
    g.playAll().revealAll();
    g.tick(10_000);
    expect(g.round.outcome).toBe('noWinner');
    g.do({ type: 'nextRound', by: 'p1' });
    expect(g.state.phase).toBe('ended');
    expect(g.state.winners).toEqual([]);
  });

  it('la rivincita riporta in lobby con i punteggi azzerati', () => {
    const g = started(3, { config: { targetScore: 1 } });
    g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    expect(g.state.phase).toBe('ended');
    expect(g.err({ type: 'rematch', by: 'p2' })).toBe('NOT_HOST');
    g.do({ type: 'rematch', by: 'p1' });
    expect(g.state.phase).toBe('lobby');
    expect(g.state.players.every((p) => p.score === 0 && p.hand.length === 0)).toBe(true);
    g.do({ type: 'start', by: 'p1' });
    expect(g.state.phase).toBe('choosing');
    assertConservation(g.state);
  });

  it('chi entra a fine partita è attivo per la rivincita', () => {
    const g = started(3, { config: { targetScore: 1 } });
    g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    g.do({ type: 'join', seat: 'p9', name: 'Ritardo' });
    expect(g.player('p9').status).toBe('active');
  });
});

describe('mazzo', () => {
  it('quando le bianche finiscono si rimescolano gli scarti', () => {
    const g = started(3, { white: makeWhite(34) });
    for (let i = 0; i < 6; i++) {
      g.playRound();
      g.do({ type: 'nextRound', by: 'p1' });
      assertConservation(g.state);
    }
    expect(g.events).toContain('reshuffled');
  });

  it('quando le nere finiscono si rimescolano gli scarti', () => {
    const g = started(3, { black: makeBlack(2), config: { targetScore: 50 } });
    for (let i = 0; i < 3; i++) {
      g.playRound();
      g.do({ type: 'nextRound', by: 'p1' });
    }
    expect(g.state.phase).toBe('choosing');
    expect(g.events.filter((e) => e === 'reshuffled').length).toBeGreaterThan(0);
    assertConservation(g.state);
  });

  it('se non si può più distribuire la partita finisce', () => {
    // 33 bianche, 3 giocatori, nere da 3: dopo il primo round le mani non si riempiono più.
    const g = lobby(3, { white: makeWhite(33), black: makeBlack(5, [3]) }).do({
      type: 'start',
      by: 'p1',
    });
    let guard = 0;
    while (g.state.phase !== 'ended' && guard++ < 30) {
      g.playRound();
      g.do({ type: 'nextRound', by: 'p1' });
    }
    expect(g.state.phase).toBe('ended');
    assertConservation(g.state);
  });

  it('senza nere disponibili la partita finisce (caso difensivo)', () => {
    const g = started(3, { config: { resultMs: 1000 } });
    g.playRound();
    // Stato costruito a mano: nessuna nera né sul tavolo né nei mazzi.
    g.state = {
      ...g.state,
      round: null,
      piles: { ...g.state.piles, blackDraw: [], blackDiscard: [] },
    };
    g.tick(1000);
    expect(g.state.phase).toBe('ended');
    expect(g.state.endReason).toBe('deck');
  });
});
