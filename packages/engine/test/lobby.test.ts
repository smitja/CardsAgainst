import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, GHOST_ID, applyConfigPatch, createGame, reduce } from '../src/index.ts';
import { Game, assertConservation, lobby, makeBlack, makeWhite, started } from './helpers.ts';

describe('creazione e ingresso', () => {
  it('parte in lobby con la configurazione di default', () => {
    const s = createGame(1);
    expect(s.phase).toBe('lobby');
    expect(s.config).toEqual(DEFAULT_CONFIG);
    expect(s.config.targetScore).toBe(7);
    expect(s.config.handSize).toBe(10);
  });

  it('il primo che entra diventa host', () => {
    const g = new Game().do({ type: 'join', seat: 'a', name: 'Anna' });
    expect(g.state.hostId).toBe('a');
    expect(g.events).toEqual(['playerJoined', 'hostChanged']);
    g.do({ type: 'join', seat: 'b', name: 'Bruno' });
    expect(g.state.hostId).toBe('a');
  });

  it('pulisce i nickname e risolve i doppioni', () => {
    const g = new Game()
      .do({ type: 'join', seat: 'a', name: '  Anna \n  Rossi ' })
      .do({ type: 'join', seat: 'b', name: 'anna rossi' })
      .do({ type: 'join', seat: 'c', name: 'Anna Rossi' })
      .do({ type: 'join', seat: 'd', name: 'Un nome davvero lunghissimo' });
    expect(g.state.players.map((p) => p.name)).toEqual([
      'Anna Rossi',
      'anna rossi 2',
      'Anna Rossi 3',
      'Un nome davvero lung',
    ]);
  });

  it('rifiuta nickname vuoti, posti occupati e il posto del fantasma', () => {
    const g = new Game().do({ type: 'join', seat: 'a', name: 'Anna' });
    expect(g.err({ type: 'join', seat: 'b', name: '   ' })).toBe('BAD_NAME');
    expect(g.err({ type: 'join', seat: 'b', name: 42 as unknown as string })).toBe('BAD_NAME');
    expect(g.err({ type: 'join', seat: 'a', name: 'Altro' })).toBe('SEAT_TAKEN');
    expect(g.err({ type: 'join', seat: GHOST_ID, name: 'Furbo' })).toBe('SEAT_TAKEN');
  });

  it('accetta al massimo dieci giocatori', () => {
    const g = new Game();
    for (let i = 0; i < 10; i++) g.do({ type: 'join', seat: `s${i}`, name: `N${i}` });
    expect(g.err({ type: 'join', seat: 'x', name: 'Undicesimo' })).toBe('ROOM_FULL');
  });

  it('connect e disconnect segnano lo stato di connessione', () => {
    const g = new Game().do({ type: 'join', seat: 'a', name: 'Anna' });
    g.do({ type: 'disconnect', seat: 'a' });
    expect(g.player('a').connected).toBe(false);
    expect(g.player('a').disconnectedAt).toBe(g.clock.now);
    g.do({ type: 'connect', seat: 'a' });
    expect(g.player('a').connected).toBe(true);
    expect(g.player('a').disconnectedAt).toBeNull();
    expect(g.err({ type: 'connect', seat: 'zzz' })).toBe('UNKNOWN_PLAYER');
  });

  it('reduce non modifica lo stato ricevuto', () => {
    const g = lobby(3);
    const frozen = JSON.stringify(g.state);
    const res = reduce(g.state, { type: 'start', by: 'p1', now: 5 });
    expect(res.ok).toBe(true);
    expect(JSON.stringify(g.state)).toBe(frozen);
  });
});

describe('configurazione', () => {
  it('solo l’host la cambia, solo in lobby', () => {
    const g = lobby(3);
    expect(g.err({ type: 'setConfig', by: 'p2', config: { targetScore: 3 } })).toBe('NOT_HOST');
    g.do({ type: 'setConfig', by: 'p1', config: { targetScore: 3, voting: true } });
    expect(g.state.config.targetScore).toBe(3);
    expect(g.state.config.voting).toBe(true);
    g.do({ type: 'start', by: 'p1' });
    expect(g.err({ type: 'setConfig', by: 'p1', config: { targetScore: 4 } })).toBe('WRONG_PHASE');
  });

  it('limita i valori e ignora i campi non ammessi', () => {
    const c = applyConfigPatch(DEFAULT_CONFIG, {
      targetScore: 999,
      handSize: 1,
      maxRounds: null,
      choosingSeconds: 3,
      judgingSeconds: 1000,
      blankCards: -4,
      ghost: 'sì' as unknown as boolean,
      dealMs: 0,
    } as never);
    expect(c.targetScore).toBe(50);
    expect(c.handSize).toBe(5);
    expect(c.maxRounds).toBeNull();
    expect(c.choosingSeconds).toBe(15);
    expect(c.judgingSeconds).toBe(300);
    expect(c.blankCards).toBe(0);
    expect(c.ghost).toBe(false);
    expect(c.dealMs).toBe(DEFAULT_CONFIG.dealMs);
    expect(applyConfigPatch(DEFAULT_CONFIG, { targetScore: Number.NaN }).targetScore).toBe(7);
  });
});

describe('caricamento carte', () => {
  it('valida le carte', () => {
    const g = lobby(3);
    const ok = makeWhite(3);
    expect(g.err({ type: 'loadCards', by: 'p2', black: makeBlack(1), white: ok })).toBe('NOT_HOST');
    const bad = [
      { black: [{ id: 'b', text: 'x', pick: 4 }], white: ok },
      { black: [{ id: 'b', text: '', pick: 1 }], white: ok },
      { black: [...makeBlack(1), ...makeBlack(1)], white: ok },
      { black: makeBlack(1), white: [{ id: 'w', text: 'x', blank: true }] },
      { black: makeBlack(1), white: [{ id: '', text: 'x' }] },
      { black: makeBlack(1), white: [...ok, ...ok] },
      { black: 'nope', white: ok },
      { black: makeBlack(1), white: makeWhite(5001) },
    ];
    for (const c of bad) {
      expect(g.err({ type: 'loadCards', by: 'p1', ...(c as { black: never; white: never }) })).toBe(
        'BAD_CARDS',
      );
    }
  });

  it('normalizza gli spazi nel testo', () => {
    const g = lobby(3, { white: [{ id: 'w', text: '  ciao\n  mondo ' }] });
    expect(g.state.cards.white.w?.text).toBe('ciao mondo');
  });
});

describe('inizio partita', () => {
  it('servono tre giocatori', () => {
    const g = lobby(2);
    expect(g.err({ type: 'start', by: 'p1' })).toBe('NOT_ENOUGH_PLAYERS');
  });

  it('servono carte sufficienti', () => {
    expect(lobby(3, { white: makeWhite(32) }).err({ type: 'start', by: 'p1' })).toBe(
      'NOT_ENOUGH_CARDS',
    );
    expect(lobby(3, { black: [] }).err({ type: 'start', by: 'p1' })).toBe('NOT_ENOUGH_CARDS');
    lobby(3, { white: makeWhite(33) }).do({ type: 'start', by: 'p1' });
  });

  it('solo l’host avvia', () => {
    expect(lobby(3).err({ type: 'start', by: 'p2' })).toBe('NOT_HOST');
  });

  it('distribuisce dieci carte a testa, pesca una nera e sceglie il giudice', () => {
    const g = started(4);
    expect(g.state.phase).toBe('choosing');
    for (const p of g.state.players) expect(p.hand).toHaveLength(10);
    expect(g.round.judge).not.toBeNull();
    expect(g.round.participants).toHaveLength(3);
    expect(g.round.participants).not.toContain(g.round.judge);
    expect(g.events).toContain('gameStarted');
    expect(g.events).toContain('roundStarted');
    assertConservation(g.state);
  });

  it('con dealMs passa per la distribuzione e poi alla scelta', () => {
    const g = started(3, { config: { dealMs: 1000 } });
    expect(g.state.phase).toBe('dealing');
    expect(g.state.deadline).toBe(g.clock.now + 1000);
    g.tick(500);
    expect(g.state.phase).toBe('dealing');
    g.tick(500);
    expect(g.state.phase).toBe('choosing');
  });

  it('lo stesso seme dà la stessa partita', () => {
    const a = started(5, { seed: 7 });
    const b = started(5, { seed: 7 });
    const c = started(5, { seed: 8 });
    expect(a.state).toEqual(b.state);
    expect(a.state.piles.whiteDraw).not.toEqual(c.state.piles.whiteDraw);
  });
});
