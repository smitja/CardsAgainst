import { describe, expect, it } from 'vitest';
import { nextWakeAt } from '../src/index.ts';
import { assertConservation, lobby, started } from './helpers.ts';

describe('giudice che cade', () => {
  it('oltre la tolleranza il round si annulla, le carte tornano e il giudice passa al successivo', () => {
    const g = started(4, { config: { resultMs: 3000 } });
    const judge = g.judge;
    const [a] = g.round.participants as [string];
    g.playFor(a);
    g.do({ type: 'disconnect', seat: judge });
    g.tick(19_999);
    expect(g.state.phase).toBe('choosing');
    g.tick(1);
    expect(g.state.phase).toBe('result');
    expect(g.round.voidReason).toBe('judgeLeft');
    expect(g.player(a).hand).toHaveLength(10);
    g.tick(3000);
    expect(g.state.phase).toBe('choosing');
    expect(g.judge).not.toBe(judge);
    assertConservation(g.state);
  });

  it('se torna in tempo non succede nulla', () => {
    const g = started(4);
    const judge = g.judge;
    g.do({ type: 'disconnect', seat: judge });
    g.tick(10_000);
    g.do({ type: 'connect', seat: judge });
    g.tick(30_000);
    expect(g.state.phase).toBe('choosing');
    expect(g.judge).toBe(judge);
  });

  it('il nuovo giudice è il primo connesso nella rotazione', () => {
    const g = started(4);
    g.playRound();
    // Disconnetto chi toccherebbe come prossimo giudice.
    const order = ['p1', 'p2', 'p3', 'p4'];
    const expected = order[(order.indexOf(g.judge) + 1) % 4] as string;
    g.do({ type: 'disconnect', seat: expected });
    g.do({ type: 'nextRound', by: 'p1' === expected ? g.judge : 'p1' });
    expect(g.judge).not.toBe(expected);
  });
});

describe('host che cade', () => {
  it('oltre la tolleranza l’host passa al giocatore connesso da più tempo', () => {
    const g = started(4);
    g.do({ type: 'disconnect', seat: 'p1' });
    g.do({ type: 'disconnect', seat: 'p2' });
    g.tick(14_998);
    expect(g.host).toBe('p1');
    g.tick(1);
    expect(g.host).toBe('p3');
    expect(g.events).toContain('hostChanged');
  });

  it('se nessuno è connesso l’host resta', () => {
    const g = lobby(3);
    for (const p of ['p1', 'p2', 'p3']) g.do({ type: 'disconnect', seat: p });
    g.tick(60_000);
    expect(g.host).toBe('p1');
  });

  it('se esce l’host passa subito al successivo', () => {
    const g = started(4);
    g.do({ type: 'leave', by: 'p1' });
    expect(g.host).toBe('p2');
  });

  it('l’host può cedere il ruolo', () => {
    const g = lobby(3);
    expect(g.err({ type: 'transferHost', by: 'p2', to: 'p3' })).toBe('NOT_HOST');
    expect(g.err({ type: 'transferHost', by: 'p1', to: 'p1' })).toBe('BAD_TARGET');
    expect(g.err({ type: 'transferHost', by: 'p1', to: 'x' })).toBe('UNKNOWN_PLAYER');
    g.do({ type: 'transferHost', by: 'p1', to: 'p3' });
    expect(g.host).toBe('p3');
  });
});

describe('giocatori assenti', () => {
  it('chi è assente oltre la tolleranza non blocca la scelta', () => {
    const g = started(4);
    const [a, b, c] = g.round.participants as [string, string, string];
    g.do({ type: 'disconnect', seat: c });
    g.playFor(a).playFor(b);
    expect(g.state.phase).toBe('choosing');
    g.tick(20_000);
    expect(g.state.phase).toBe('revealing');
    expect(g.round.order).toHaveLength(2);
  });

  it('chi è già assente quando inizia il round viene saltato subito', () => {
    const g = started(4);
    g.playRound();
    const absent = g.state.players.find((p) => p.id !== g.judge)?.id as string;
    g.do({ type: 'disconnect', seat: absent });
    g.clock.advance(25_000);
    g.do({ type: 'nextRound', by: 'p1' === absent ? g.judge : 'p1' });
    if (g.round.participants.includes(absent)) {
      g.playAll([absent]);
      expect(g.state.phase).toBe('revealing');
    }
  });
});

describe('ingresso a partita in corso', () => {
  it('aspetta il round successivo e poi gioca', () => {
    const g = started(3);
    g.do({ type: 'join', seat: 'p4', name: 'Tardi' });
    expect(g.player('p4').status).toBe('waiting');
    expect(g.player('p4').hand).toHaveLength(0);
    expect(g.round.participants).not.toContain('p4');
    expect(g.err({ type: 'play', by: 'p4', cards: ['w1'] })).toBe('NOT_PARTICIPANT');
    g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    expect(g.player('p4').status).toBe('active');
    expect(g.player('p4').hand).toHaveLength(10);
    assertConservation(g.state);
  });
});

describe('espulsione e uscita', () => {
  it('solo l’host espelle, non se stesso', () => {
    const g = started(4);
    expect(g.err({ type: 'kick', by: 'p2', target: 'p3' })).toBe('NOT_HOST');
    expect(g.err({ type: 'kick', by: 'p1', target: 'p1' })).toBe('BAD_TARGET');
    expect(g.err({ type: 'kick', by: 'p1', target: 'zzz' })).toBe('UNKNOWN_PLAYER');
  });

  it('le carte dell’espulso vanno negli scarti', () => {
    const g = started(5);
    const target = g.round.participants.find((p) => p !== 'p1') as string;
    g.playFor(target);
    g.do({ type: 'kick', by: 'p1', target });
    expect(g.state.players.some((p) => p.id === target)).toBe(false);
    expect(g.round.participants).not.toContain(target);
    expect(g.round.submissions.some((s) => s.by === target)).toBe(false);
    expect(g.state.piles.whiteDiscard).toHaveLength(10);
    expect(g.events).toContain('playerLeft');
    assertConservation(g.state);
  });

  it('espellere il giudice annulla il round', () => {
    const g = started(4);
    if (g.judge === 'p1') g.do({ type: 'transferHost', by: 'p1', to: 'p2' });
    const host = g.host;
    g.playFor(g.round.participants[0] as string);
    g.do({ type: 'kick', by: host, target: g.judge });
    expect(g.state.phase).toBe('result');
    expect(g.round.voidReason).toBe('judgeLeft');
    assertConservation(g.state);
  });

  it('sotto i tre giocatori la partita va in pausa e riparte quando entra qualcuno', () => {
    const g = started(3);
    const target = g.state.players.find((p) => p.id !== 'p1' && p.id !== g.judge)?.id as string;
    g.do({ type: 'kick', by: 'p1', target });
    expect(g.state.phase).toBe('result');
    expect(g.round.voidReason).toBe('notEnoughPlayers');
    g.do({ type: 'nextRound', by: 'p1' });
    expect(g.state.phase).toBe('paused');
    expect(g.state.round).toBeNull();
    g.do({ type: 'join', seat: 'p9', name: 'Salvatore' });
    expect(g.state.phase).toBe('choosing');
    expect(g.player('p9').hand).toHaveLength(10);
    assertConservation(g.state);
  });

  it('uscire durante la rivelazione toglie la risposta e aggiusta il conteggio', () => {
    const g = started(5);
    if (g.judge === 'p1') g.do({ type: 'transferHost', by: 'p1', to: 'p2' });
    g.playAll();
    g.do({ type: 'reveal', by: g.judge, index: 0 });
    g.do({ type: 'reveal', by: g.judge, index: 1 });
    const firstSid = g.round.order[0] as string;
    const leaver = g.round.submissions.find((s) => s.id === firstSid)?.by as string;
    g.do({ type: 'leave', by: leaver });
    expect(g.round.order).toHaveLength(3);
    expect(g.round.revealed).toBe(1);
    expect(g.state.phase).toBe('revealing');
    assertConservation(g.state);
  });

  it('se l’ultima da svelare sparisce si passa al giudizio', () => {
    const g = started(5);
    g.playAll();
    for (let i = 0; i < 3; i++) g.do({ type: 'reveal', by: g.judge, index: i });
    const lastSid = g.round.order[3] as string;
    const leaver = g.round.submissions.find((s) => s.id === lastSid)?.by as string;
    g.do({ type: 'leave', by: leaver });
    expect(g.state.phase).toBe('judging');
  });

  it('se restano meno di due risposte in giudizio il round si annulla', () => {
    const g = started(4, { config: { ghost: false } });
    // Quattro umani: giudice + tre risposte. Ne escono due.
    g.do({ type: 'join', seat: 'p5', name: 'Riserva' });
    g.playAll().revealAll();
    const authors = g.round.submissions.map((s) => s.by).filter((id) => id !== 'p1');
    g.do({ type: 'leave', by: authors[0] as string });
    expect(g.state.phase).toBe('judging');
    g.do({ type: 'leave', by: authors[1] as string });
    expect(g.state.phase).toBe('result');
    expect(g.round.outcome).toBe('voided');
  });

  it('uscire durante il voto ricalcola il completamento', () => {
    const g = started(4, { config: { voting: true } });
    g.playAll();
    for (let i = 0; i < 4; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    const sub = (by: string) => g.round.submissions.find((s) => s.by === by)?.id as string;
    g.do({ type: 'vote', by: 'p1', submission: sub('p2') });
    g.do({ type: 'vote', by: 'p2', submission: sub('p1') });
    g.do({ type: 'vote', by: 'p3', submission: sub('p4') });
    g.do({ type: 'leave', by: 'p4' });
    // Il voto di p3 era per una risposta sparita: va rifatto.
    expect(g.state.phase).toBe('judging');
    expect(g.round.votes.p3).toBeUndefined();
    g.do({ type: 'vote', by: 'p3', submission: sub('p2') });
    expect(g.state.phase).toBe('result');
    expect(g.round.winners).toEqual(['p2']);
  });

  it('uscire nel risultato lascia visibile la risposta', () => {
    const g = started(4);
    const winner = g.playRound();
    if (winner === 'p1') return;
    g.do({ type: 'leave', by: winner });
    expect(g.round.submissions.some((s) => s.by === winner)).toBe(true);
    g.do({ type: 'nextRound', by: g.host });
    assertConservation(g.state);
  });

  it('in lobby uscire toglie solo il giocatore', () => {
    const g = lobby(3);
    g.do({ type: 'leave', by: 'p3' });
    expect(g.state.players).toHaveLength(2);
    expect(g.state.phase).toBe('lobby');
  });

  it('l’ultimo che esce lascia la stanza senza host', () => {
    const g = lobby(1);
    g.do({ type: 'leave', by: 'p1' });
    expect(g.state.hostId).toBeNull();
  });
});

describe('prossimo risveglio', () => {
  it('riporta la scadenza più vicina nel futuro', () => {
    const g = started(4, { config: { choosingSeconds: 60 } });
    const now = g.clock.now;
    expect(nextWakeAt(g.state, now)).toBe(now + 60_000);
    const a = g.round.participants.find((id) => id !== 'p1') as string;
    g.do({ type: 'disconnect', seat: a });
    const tA = g.clock.now;
    expect(nextWakeAt(g.state, g.clock.now)).toBe(tA + 20_000);
    g.do({ type: 'disconnect', seat: g.judge });
    // Se il giudice è anche host, scade prima la tolleranza dell'host.
    expect(nextWakeAt(g.state, g.clock.now)).toBe(
      g.judge === 'p1' ? g.clock.now + 15_000 : tA + 20_000,
    );
    expect(nextWakeAt(g.state, g.clock.now + 100_000)).toBeNull();
  });

  it('considera host e votanti assenti', () => {
    const g = started(4, { config: { voting: true } });
    g.do({ type: 'disconnect', seat: 'p1' });
    expect(nextWakeAt(g.state, g.clock.now)).toBe(g.clock.now + 15_000);
    g.do({ type: 'connect', seat: 'p1' });
    g.playAll();
    for (let i = 0; i < 4; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    g.do({ type: 'disconnect', seat: 'p3' });
    expect(nextWakeAt(g.state, g.clock.now)).toBe(g.clock.now + 20_000);
  });

  it('in lobby senza assenti non serve svegliarsi', () => {
    expect(nextWakeAt(lobby(3).state, 0)).toBeNull();
  });
});
