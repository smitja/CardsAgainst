import { describe, expect, it } from 'vitest';
import { GHOST_ID } from '../src/index.ts';
import { assertConservation, started } from './helpers.ts';

describe('giocatore fantasma', () => {
  it('entra all’avvio, gioca da solo e non giudica mai', () => {
    const g = started(3, { config: { ghost: true } });
    const ghost = g.player(GHOST_ID);
    expect(ghost.kind).toBe('ghost');
    expect(ghost.hand).toHaveLength(9);
    expect(g.round.participants).toContain(GHOST_ID);
    expect(g.round.submissions.map((s) => s.by)).toEqual([GHOST_ID]);
    for (let i = 0; i < 6; i++) {
      expect(g.judge).not.toBe(GHOST_ID);
      g.playRound();
      g.do({ type: 'nextRound', by: 'p1' });
    }
    assertConservation(g.state);
  });

  it('può vincere', () => {
    const g = started(3, { config: { ghost: true } });
    g.playAll().revealAll();
    const sub = g.round.submissions.find((s) => s.by === GHOST_ID);
    g.do({ type: 'pick', by: g.judge, submission: sub?.id as string });
    expect(g.player(GHOST_ID).score).toBe(1);
  });

  it('non si può espellere né far connettere', () => {
    const g = started(3, { config: { ghost: true } });
    expect(g.err({ type: 'kick', by: 'p1', target: GHOST_ID })).toBe('BAD_TARGET');
    expect(g.err({ type: 'disconnect', seat: GHOST_ID })).toBe('BAD_TARGET');
    expect(g.err({ type: 'transferHost', by: 'p1', to: GHOST_ID })).toBe('BAD_TARGET');
  });

  it('con una jolly in mano preferisce le carte scritte, poi usa la jolly', () => {
    const g = started(3, { config: { ghost: true, blankCards: 50 }, white: [] });
    // Mazzo di sole jolly: il fantasma gioca comunque, con un testo suo.
    expect(g.round.submissions[0]?.texts[0]).toBe('il silenzio imbarazzato del Fantasma');
  });

  it('sparisce con la rivincita', () => {
    const g = started(3, { config: { ghost: true, targetScore: 1 } });
    g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    g.do({ type: 'rematch', by: 'p1' });
    expect(g.state.players.some((p) => p.id === GHOST_ID)).toBe(false);
  });
});

describe('scambio della mano', () => {
  it('serve la regola attiva', () => {
    const g = started(3);
    expect(g.err({ type: 'swapHand', by: g.round.participants[0] as string })).toBe(
      'RULE_DISABLED',
    );
  });

  it('costa un punto e ridà dieci carte nuove', () => {
    const g = started(3, { config: { handSwap: true } });
    const winner = g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    expect(
      g.err({ type: 'swapHand', by: g.state.players.find((p) => p.score === 0)?.id as string }),
    ).toBe('NO_POINTS');
    const before = [...g.player(winner).hand];
    g.do({ type: 'swapHand', by: winner });
    expect(g.player(winner).score).toBe(0);
    expect(g.player(winner).hand).toHaveLength(10);
    expect(g.player(winner).hand).not.toEqual(before);
    expect(g.events).toContain('handSwapped');
    assertConservation(g.state);
  });

  it('non dopo aver giocato e non fuori dalla scelta', () => {
    const g = started(3, { config: { handSwap: true } });
    const winner = g.playRound();
    expect(g.err({ type: 'swapHand', by: winner })).toBe('WRONG_PHASE');
    g.do({ type: 'nextRound', by: 'p1' });
    if (g.round.participants.includes(winner)) {
      g.playFor(winner);
      expect(g.err({ type: 'swapHand', by: winner })).toBe('ALREADY_PLAYED');
    }
    expect(g.err({ type: 'swapHand', by: 'nessuno' })).toBe('UNKNOWN_PLAYER');
  });
});

describe('carte jolly', () => {
  it('si aggiungono al mazzo e chiedono un testo', () => {
    const g = started(3, { config: { blankCards: 120 } });
    expect(Object.values(g.state.cards.white).filter((c) => c.blank)).toHaveLength(120);
    const a = g.round.participants.find((id) =>
      g.player(id).hand.some((c) => c.startsWith('blank-')),
    );
    expect(a).toBeDefined();
    const blank = g.player(a as string).hand.find((c) => c.startsWith('blank-')) as string;
    expect(g.err({ type: 'play', by: a as string, cards: [blank] })).toBe('BAD_TEXT');
    expect(
      g.err({ type: 'play', by: a as string, cards: [blank], blankTexts: { [blank]: '   ' } }),
    ).toBe('BAD_TEXT');
    expect(
      g.err({
        type: 'play',
        by: a as string,
        cards: [blank],
        blankTexts: { [blank]: 'x'.repeat(81) },
      }),
    ).toBe('BAD_TEXT');
    g.do({
      type: 'play',
      by: a as string,
      cards: [blank],
      blankTexts: { [blank]: '  mio  cugino ' },
    });
    expect(g.round.submissions[0]?.texts).toEqual(['mio cugino']);
    expect(g.state.cards.white[blank]?.text).toBe('');
  });

  it('si ricreano a ogni avvio senza duplicarsi', () => {
    const g = started(3, { config: { blankCards: 5, targetScore: 1 } });
    g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    g.do({ type: 'rematch', by: 'p1' });
    g.do({ type: 'setConfig', by: 'p1', config: { blankCards: 2 } });
    g.do({ type: 'start', by: 'p1' });
    expect(Object.values(g.state.cards.white).filter((c) => c.blank)).toHaveLength(2);
    assertConservation(g.state);
  });
});

describe('voto collettivo', () => {
  it('non c’è giudice e giocano tutti', () => {
    const g = started(4, { config: { voting: true } });
    expect(g.round.judge).toBeNull();
    expect(g.round.participants).toHaveLength(4);
  });

  it('svela chiunque sia attivo; non si vota la propria risposta', () => {
    const g = started(3, { config: { voting: true } });
    g.playAll();
    g.do({ type: 'reveal', by: 'p2', index: 0 });
    g.do({ type: 'reveal', by: 'p3', index: 1 });
    g.do({ type: 'reveal', by: 'p1', index: 2 });
    expect(g.state.phase).toBe('judging');
    const own = g.round.submissions.find((s) => s.by === 'p1')?.id as string;
    expect(g.err({ type: 'vote', by: 'p1', submission: own })).toBe('OWN_SUBMISSION');
    expect(g.err({ type: 'vote', by: 'p1', submission: 'boh' })).toBe('UNKNOWN_SUBMISSION');
    expect(g.err({ type: 'pick', by: 'p1', submission: own })).toBe('NOT_ALLOWED');
  });

  it('a voti completi vince la più votata', () => {
    const g = started(3, { config: { voting: true } });
    g.playAll();
    for (let i = 0; i < 3; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    const sub = (by: string) => g.round.submissions.find((s) => s.by === by)?.id as string;
    g.do({ type: 'vote', by: 'p1', submission: sub('p2') });
    g.do({ type: 'vote', by: 'p1', submission: sub('p3') }); // si può cambiare idea
    g.do({ type: 'vote', by: 'p2', submission: sub('p3') });
    expect(g.state.phase).toBe('judging');
    g.do({ type: 'vote', by: 'p3', submission: sub('p1') });
    expect(g.state.phase).toBe('result');
    expect(g.round.winners).toEqual(['p3']);
    expect(g.player('p3').score).toBe(1);
  });

  it('a pari voti il punto va a tutti i più votati', () => {
    const g = started(3, { config: { voting: true } });
    g.playAll();
    for (let i = 0; i < 3; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    const sub = (by: string) => g.round.submissions.find((s) => s.by === by)?.id as string;
    g.do({ type: 'vote', by: 'p1', submission: sub('p2') });
    g.do({ type: 'vote', by: 'p2', submission: sub('p3') });
    g.do({ type: 'vote', by: 'p3', submission: sub('p1') });
    expect([...g.round.winners].sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('allo scadere del tempo si contano i voti presenti', () => {
    const g = started(3, { config: { voting: true, judgingSeconds: 10 } });
    g.playAll();
    for (let i = 0; i < 3; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    const sub = (by: string) => g.round.submissions.find((s) => s.by === by)?.id as string;
    g.do({ type: 'vote', by: 'p1', submission: sub('p2') });
    g.tick(10_000);
    expect(g.round.winners).toEqual(['p2']);
  });

  it('senza voti allo scadere non vince nessuno', () => {
    const g = started(3, { config: { voting: true, judgingSeconds: 10 } });
    g.playAll();
    for (let i = 0; i < 3; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    g.tick(10_000);
    expect(g.round.outcome).toBe('noWinner');
    expect(g.err({ type: 'nextRound', by: 'p2' })).toBe('NOT_ALLOWED');
    g.do({ type: 'nextRound', by: 'p1' });
  });

  it('chi è assente oltre la tolleranza non blocca il voto', () => {
    const g = started(4, { config: { voting: true } });
    g.playAll();
    for (let i = 0; i < 4; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    g.do({ type: 'disconnect', seat: 'p4' });
    const sub = (by: string) => g.round.submissions.find((s) => s.by === by)?.id as string;
    g.do({ type: 'vote', by: 'p1', submission: sub('p2') });
    g.do({ type: 'vote', by: 'p2', submission: sub('p1') });
    g.do({ type: 'vote', by: 'p3', submission: sub('p2') });
    expect(g.state.phase).toBe('judging');
    g.tick(20_000);
    expect(g.state.phase).toBe('result');
    expect(g.round.winners).toEqual(['p2']);
  });
});

describe('timer', () => {
  it('allo scadere della scelta chi non ha giocato salta il round', () => {
    const g = started(4, { config: { choosingSeconds: 30 } });
    expect(g.state.deadline).toBe(g.clock.now + 30_000);
    const [a, b, c] = g.round.participants as [string, string, string];
    g.playFor(a).playFor(b);
    g.tick(30_000);
    expect(g.state.phase).toBe('revealing');
    expect(g.round.order).toHaveLength(2);
    expect(g.player(c).hand).toHaveLength(10);
  });

  it('con meno di due risposte il round è annullato e le carte tornano in mano', () => {
    const g = started(3, { config: { choosingSeconds: 30, resultMs: 4000 } });
    const [a] = g.round.participants as [string];
    g.playFor(a);
    g.tick(30_000);
    expect(g.state.phase).toBe('result');
    expect(g.round.outcome).toBe('voided');
    expect(g.round.voidReason).toBe('fewAnswers');
    expect(g.player(a).hand).toHaveLength(10);
    expect(g.state.roundsPlayed).toBe(0);
    g.tick(4000);
    expect(g.state.phase).toBe('choosing');
    assertConservation(g.state);
  });

  it('allo scadere del giudizio il round passa senza punto', () => {
    const g = started(3, { config: { judgingSeconds: 20 } });
    g.playAll().revealAll();
    expect(g.state.deadline).toBe(g.clock.now + 20_000);
    g.tick(20_000);
    expect(g.round.outcome).toBe('noWinner');
    expect(g.state.players.every((p) => p.score === 0)).toBe(true);
    expect(g.state.roundsPlayed).toBe(1);
  });

  it('un tick senza scadenze non cambia nulla', () => {
    const g = started(3);
    const before = JSON.stringify(g.state);
    g.tick(1_000_000);
    expect(JSON.stringify(g.state)).toBe(before);
  });
});
