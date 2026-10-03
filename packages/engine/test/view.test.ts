import { describe, expect, it } from 'vitest';
import { GHOST_ID, viewFor } from '../src/index.ts';
import { started } from './helpers.ts';

const othersHandTexts = (g: ReturnType<typeof started>, seat: string) =>
  g.state.players
    .filter((p) => p.id !== seat)
    .flatMap((p) => p.hand.map((id) => g.state.cards.white[id]?.text as string));

describe('viste per giocatore', () => {
  it('ognuno vede solo la propria mano', () => {
    const g = started(4);
    for (const p of g.state.players) {
      const v = viewFor(g.state, p.id);
      expect(v.me?.hand.map((c) => c.id)).toEqual(p.hand);
      const json = JSON.stringify(v);
      for (const text of othersHandTexts(g, p.id)) expect(json).not.toContain(text);
    }
  });

  it('le risposte restano nascoste finché non vengono svelate', () => {
    const g = started(4);
    const [a, b] = g.round.participants as [string, string];
    g.playFor(a);
    const playedText = g.round.submissions[0]?.texts[0] as string;
    const vb = viewFor(g.state, b);
    expect(vb.round?.played).toBe(1);
    expect(vb.round?.submissions).toEqual([]);
    expect(JSON.stringify(vb)).not.toContain(playedText);
    expect(vb.players.find((p) => p.id === a)?.played).toBe(true);
    // Chi ha giocato vede la propria giocata.
    expect(viewFor(g.state, a).me?.submission?.texts).toEqual([playedText]);

    g.playAll();
    let v = viewFor(g.state, g.judge);
    expect(v.round?.total).toBe(3);
    expect(v.round?.submissions).toEqual([]);
    g.do({ type: 'reveal', by: g.judge, index: 0 });
    v = viewFor(g.state, g.judge);
    expect(v.round?.submissions).toHaveLength(1);
    expect(v.round?.submissions[0]?.id).toBe(g.round.order[0]);
    const hidden = g.round.submissions
      .filter((s) => s.id !== g.round.order[0])
      .flatMap((s) => s.texts);
    for (const t of hidden) expect(JSON.stringify(v)).not.toContain(t);
  });

  it('le risposte sono anonime; nel risultato si vede solo l’autore della vincitrice', () => {
    const g = started(4);
    g.playAll().revealAll();
    const v = viewFor(g.state, g.judge);
    expect(v.round?.submissions.every((s) => s.author === null)).toBe(true);
    const json = JSON.stringify(v.round?.submissions);
    for (const p of g.state.players) expect(json).not.toContain(`"${p.id}"`);
    const sid = g.round.order[2] as string;
    g.do({ type: 'pick', by: g.judge, submission: sid });
    const r = viewFor(g.state, null).round;
    const author = g.round.submissions.find((s) => s.id === sid)?.by;
    expect(r?.submissions.find((s) => s.id === sid)?.author).toBe(author);
    expect(r?.submissions.filter((s) => s.id !== sid).every((s) => s.author === null)).toBe(true);
    expect(r?.submissions.every((s) => s.votes === null)).toBe(true);
  });

  it('nel voto collettivo il risultato mostra i voti', () => {
    const g = started(3, { config: { voting: true } });
    g.playAll();
    for (let i = 0; i < 3; i++) g.do({ type: 'reveal', by: 'p1', index: i });
    const sub = (by: string) => g.round.submissions.find((s) => s.by === by)?.id as string;
    g.do({ type: 'vote', by: 'p1', submission: sub('p2') });
    expect(viewFor(g.state, 'p1').me?.vote).toBe(sub('p2'));
    expect(viewFor(g.state, 'p2').players.find((p) => p.id === 'p1')?.voted).toBe(true);
    expect(viewFor(g.state, 'p2').round?.submissions.every((s) => s.votes === null)).toBe(true);
    g.do({ type: 'vote', by: 'p2', submission: sub('p1') });
    g.do({ type: 'vote', by: 'p3', submission: sub('p2') });
    const r = viewFor(g.state, null).round;
    expect(r?.submissions.find((s) => s.id === sub('p2'))?.votes).toBe(2);
  });

  it('lo schermo condiviso e il fantasma non hanno mano', () => {
    const g = started(3, { config: { ghost: true, blankCards: 3 } });
    expect(viewFor(g.state, null).me).toBeNull();
    expect(viewFor(g.state, GHOST_ID).me).toBeNull();
    expect(viewFor(g.state, 'nessuno').me).toBeNull();
    const v = viewFor(g.state, null);
    expect(v.deck.white).toBe(120);
    expect(v.players.find((p) => p.id === g.judge)?.isJudge).toBe(true);
    expect(v.players.find((p) => p.id === 'p1')?.isHost).toBe(true);
  });

  it('in lobby non c’è round', () => {
    const g = started(3, { config: { targetScore: 1 } });
    g.playRound();
    g.do({ type: 'nextRound', by: 'p1' });
    const v = viewFor(g.state, 'p1');
    expect(v.phase).toBe('ended');
    expect(v.round).toBeNull();
    expect(v.me?.submission).toBeNull();
    expect(v.winners).toHaveLength(1);
  });
});
