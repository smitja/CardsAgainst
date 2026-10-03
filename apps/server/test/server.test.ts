import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CIRELLI_DECK, DEMO_DECK } from '@cirelli/decks';
import type { GameConfig } from '@cirelli/engine';
import { startServer } from '../src/server.ts';
import { MemoryStore, SqliteStore, type Store } from '../src/store.ts';
import { TestClient } from './client.ts';

type Server = Awaited<ReturnType<typeof startServer>>;
const servers: Server[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const s of servers.splice(0)) await s.close();
});

async function boot(
  opts: { store?: Store; timings?: Partial<GameConfig>; staticDir?: string } = {},
) {
  const server = await startServer({
    store: opts.store ?? new MemoryStore(),
    port: 0,
    host: '127.0.0.1',
    staticDir: opts.staticDir ?? null,
    timings: { dealMs: 0, resultMs: null, ...opts.timings },
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.port}`;
  const client = () => {
    const c = new TestClient(server.port);
    clients.push(c);
    return c;
  };
  const newRoom = async () => {
    const res = await fetch(`${base}/api/rooms`, { method: 'POST' });
    return ((await res.json()) as { code: string }).code;
  };
  /** Stanza con n giocatori già dentro. */
  const table = async (n: number) => {
    const code = await newRoom();
    const players: TestClient[] = [];
    for (let i = 0; i < n; i++) {
      const c = client();
      await c.hello(code, { name: `Giocatore ${i + 1}` });
      await c.view((v) => v.players.length === i + 1 && v.deck.white > 0);
      players.push(c);
    }
    return { code, players };
  };
  return { server, base, client, newRoom, table };
}

describe('API HTTP', () => {
  it('crea stanze e ne restituisce le informazioni', async () => {
    const { base, newRoom } = await boot();
    const code = await newRoom();
    expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    const info = await (await fetch(`${base}/api/rooms/${code.toLowerCase()}`)).json();
    expect(info).toEqual({ code, phase: 'lobby', players: 0, full: false });
    expect((await fetch(`${base}/api/rooms/BBBB`)).status).toBe(404);
    expect((await fetch(`${base}/api/boh`)).status).toBe(404);
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({ ok: true, rooms: 1 });
  });

  it('serve la SPA con fallback e cache per gli asset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cirelli-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>ok</title>');
    writeFileSync(join(dir, 'assets', 'app-123.js'), 'console.log(1)');
    const { base } = await boot({ staticDir: dir });
    const page = await fetch(`${base}/r/BRMT`);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<title>ok</title>');
    const asset = await fetch(`${base}/assets/app-123.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const sneaky = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    expect(await sneaky.text()).toContain('<title>ok</title>');
  });
});

describe('ingresso nella stanza', () => {
  it('il primo giocatore diventa host e trova il mazzo di casa già caricato', async () => {
    const { table } = await boot();
    const { players } = await table(1);
    const host = players[0] as TestClient;
    const v = host.latest;
    expect(host.token).toBeTruthy();
    expect(v.hostId).toBe(host.seat);
    expect(v.deck).toEqual({ black: CIRELLI_DECK.black.length, white: 343 });
    const room = host.latestState()?.room;
    expect(room?.decks).toEqual([
      {
        code: 'cirelli',
        name: 'Cards Against Cirelli',
        black: CIRELLI_DECK.black.length,
        white: 343,
      },
    ]);
    expect(room?.available.map((d) => d.code)).toEqual(['cirelli', 'demo']);
  });

  it('rifiuta stanze inesistenti, nickname mancanti e token sconosciuti', async () => {
    const { client, newRoom } = await boot();
    const code = await newRoom();
    const a = client();
    await a.hello('BBBB', { name: 'Anna' });
    expect(await a.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'ROOM_NOT_FOUND' });
    const b = client();
    await b.hello(code);
    expect(await b.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'NAME_REQUIRED' });
    const c = client();
    await c.hello(code, { token: 'x'.repeat(32) });
    expect(await c.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'BAD_TOKEN' });
    const d = client();
    await d.hello(code, { name: '   ' });
    expect(await d.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'BAD_NAME' });
  });

  it('scarta messaggi malformati e intenti prima di entrare', async () => {
    const { client } = await boot();
    const a = client();
    await a.opened();
    a.send('{non json');
    expect(await a.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'BAD_MESSAGE' });
    a.intent({ type: 'start' });
    expect(await a.waitFor((m) => m.t === 'error' && m.code === 'NOT_JOINED')).toBeTruthy();
    a.send({ t: 'ping', at: 5 });
    expect(await a.waitFor((m) => m.t === 'error' && m.code === 'NOT_JOINED')).toBeTruthy();
  });

  it('limita i messaggi troppo frequenti', async () => {
    const { table } = await boot();
    const { players } = await table(1);
    const host = players[0] as TestClient;
    for (let i = 0; i < 60; i++) host.send({ t: 'ping', at: i });
    expect(await host.waitFor((m) => m.t === 'error' && m.code === 'RATE_LIMIT')).toBeTruthy();
  });

  it('risponde al ping con l’ora del server', async () => {
    const { table } = await boot();
    const host = (await table(1)).players[0] as TestClient;
    host.send({ t: 'ping', at: 42 });
    const pong = await host.waitFor((m) => m.t === 'pong');
    expect(pong).toMatchObject({ at: 42 });
  });
});

describe('partita via WebSocket', () => {
  it('ognuno riceve solo la propria mano e un round si gioca fino in fondo', async () => {
    const { table } = await boot();
    const { players } = await table(3);
    const [host] = players as [TestClient];
    expect((await host.ack({ type: 'start' })).ok).toBe(true);

    const views = await Promise.all(players.map((p) => p.view((v) => v.phase === 'choosing')));
    for (const [i, v] of views.entries()) {
      expect(v.me?.hand).toHaveLength(10);
      const others = views
        .filter((_, j) => j !== i)
        .flatMap((o) => o.me?.hand.map((c) => c.text) ?? []);
      const json = JSON.stringify(players[i]?.messages);
      for (const t of others) expect(json).not.toContain(t);
    }

    const judgeSeat = views[0]?.round?.judge;
    const judge = players.find((p) => p.seat === judgeSeat) as TestClient;
    const pick = views[0]?.round?.black.pick ?? 1;
    for (const p of players) {
      if (p === judge) continue;
      const hand = p.latest.me?.hand ?? [];
      const res = await p.ack({ type: 'play', cards: hand.slice(0, pick).map((c) => c.id) });
      expect(res.ok).toBe(true);
    }
    await judge.view((v) => v.phase === 'revealing');
    const bad = await players.find((p) => p !== judge)?.ack({ type: 'reveal', index: 0 });
    expect(bad).toMatchObject({ ok: false, error: 'NOT_ALLOWED' });
    await judge.ack({ type: 'reveal', index: 0 });
    await judge.ack({ type: 'reveal', index: 1 });
    const v = await judge.view((x) => x.phase === 'judging');
    await judge.ack({ type: 'pick', submission: v.round?.submissions[0]?.id as string });
    const result = await host.view((x) => x.phase === 'result');
    expect(result.round?.winners).toHaveLength(1);
    await judge.ack({ type: 'nextRound' });
    const next = await host.view((x) => x.phase === 'choosing' && x.round?.number === 2);
    expect(next.me?.hand).toHaveLength(10);
  });

  it('lo schermo condiviso non ha mano', async () => {
    const { table, client } = await boot();
    const { code, players } = await table(3);
    await players[0]?.ack({ type: 'start' });
    const tv = client();
    await tv.hello(code, { role: 'screen' });
    const v = await tv.view((x) => x.phase === 'choosing');
    expect(v.me).toBeNull();
    expect(tv.seat).toBeNull();
    expect((await tv.ack({ type: 'start' })).ok).toBe(false);
  });

  it('l’host sceglie i mazzi; un codice sconosciuto è un errore', async () => {
    const store = new MemoryStore();
    await store.saveDeck({
      shareCode: 'AB12CD',
      deck: {
        ...DEMO_DECK,
        id: 'extra',
        name: 'Extra',
        white: DEMO_DECK.white.slice(0, 10).map((c) => ({ text: `${c.text}!?`, kind: c.kind })),
      },
      editTokenHash: 'x',
      createdAt: 0,
      updatedAt: 0,
    });
    const { table } = await boot({ store });
    const { players } = await table(2);
    const [host, other] = players as [TestClient, TestClient];
    expect(await other.ack({ type: 'setDecks', decks: ['demo'] })).toMatchObject({
      ok: false,
      error: 'NOT_HOST',
    });
    expect(await host.ack({ type: 'setDecks', decks: ['ZZ99ZZ'] })).toMatchObject({
      ok: false,
      error: 'DECK_NOT_FOUND',
    });
    expect(await host.ack({ type: 'setDecks', decks: ['boh'] })).toMatchObject({
      ok: false,
      error: 'DECK_NOT_FOUND',
    });
    expect((await host.ack({ type: 'setDecks', decks: ['cirelli', 'demo'] })).ok).toBe(true);
    await host.view((v) => v.deck.white === 443);
    expect((await host.ack({ type: 'setDecks', decks: ['demo', 'AB12CD'] })).ok).toBe(true);
    const s = await host.waitFor((m) => m.t === 'state' && m.room.decks[1]?.code === 'AB12CD');
    expect(s.t === 'state' && s.room.decks[1]).toMatchObject({ code: 'AB12CD', name: 'Extra' });
    // Le dieci bianche "extra" sono doppioni del demo: non si contano due volte.
    expect(host.latest.deck).toEqual({ black: 30, white: 100 });
  });
});

describe('resilienza', () => {
  it('chi si riconnette col token ritrova posto e mano', async () => {
    const { table, client } = await boot();
    const { code, players } = await table(3);
    await players[0]?.ack({ type: 'start' });
    const p2 = players[1] as TestClient;
    const before = await p2.view((v) => v.phase === 'choosing');
    p2.close();
    await players[0]?.view((v) => v.players.some((p) => p.id === p2.seat && !p.connected));

    const again = client();
    await again.hello(code, { token: p2.token as string });
    const after = await again.view((v) => v.phase === 'choosing');
    expect(again.seat).toBe(p2.seat);
    expect(after.me?.hand).toEqual(before.me?.hand);
    await players[0]?.view((v) => v.players.find((p) => p.id === p2.seat)?.connected === true);
  });

  it('con due schede aperte il giocatore resta connesso finché ne chiude una', async () => {
    const { table, client } = await boot();
    const { code, players } = await table(3);
    const p2 = players[1] as TestClient;
    const tab = client();
    await tab.hello(code, { token: p2.token as string });
    await tab.view();
    p2.close();
    await new Promise((ok) => setTimeout(ok, 50));
    expect(players[0]?.latest.players.find((p) => p.id === p2.seat)?.connected).toBe(true);
  });

  it('l’espulso viene chiuso e non può rientrare con lo stesso token', async () => {
    const { table, client } = await boot();
    const { code, players } = await table(3);
    const [host, , victim] = players as [TestClient, TestClient, TestClient];
    expect((await host.ack({ type: 'kick', target: victim.seat as string })).ok).toBe(true);
    expect(await victim.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'KICKED' });
    await victim.waitClosed();
    const back = client();
    await back.hello(code, { token: victim.token as string, name: 'Di nuovo io' });
    expect(await back.waitFor((m) => m.t === 'error')).toMatchObject({ code: 'KICKED' });
    expect(host.latest.players).toHaveLength(2);
  });

  it('chi esce di sua volontà libera il posto', async () => {
    const { table } = await boot();
    const { players } = await table(3);
    const leaver = players[2] as TestClient;
    await leaver.ack({ type: 'leave' });
    await leaver.waitClosed();
    await players[0]?.view((v) => v.players.length === 2);
  });

  it('se l’host sparisce, dopo la tolleranza il ruolo passa a un altro', async () => {
    const { table } = await boot({ timings: { hostGraceMs: 150 } });
    const { players } = await table(3);
    const [host, second] = players as [TestClient, TestClient];
    host.close();
    const v = await second.view((x) => x.hostId === second.seat, 2000);
    expect(v.players.find((p) => p.id === second.seat)?.isHost).toBe(true);
  });

  it('se il giudice sparisce il round si annulla e si va avanti', async () => {
    const { table } = await boot({ timings: { judgeGraceMs: 150, resultMs: 100 } });
    const { players } = await table(4);
    await players[0]?.ack({ type: 'start' });
    const v = await players[0]?.view((x) => x.phase === 'choosing');
    const judge = players.find((p) => p.seat === v?.round?.judge) as TestClient;
    const watcher = players.find((p) => p !== judge) as TestClient;
    judge.close();
    await watcher.view((x) => x.round?.voidReason === 'judgeLeft', 2000);
    const next = await watcher.view((x) => x.phase === 'choosing' && x.round?.number === 2, 2000);
    expect(next.round?.judge).not.toBe(judge.seat);
  });

  it('dopo un riavvio le stanze ripartono dal database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cirelli-db-'));
    const path = join(dir, 'test.db');
    const first = await boot({ store: await SqliteStore.open(path) });
    const { code, players } = await first.table(3);
    await players[0]?.ack({ type: 'start' });
    const before = await players[1]?.view((v) => v.phase === 'choosing');
    const token = players[1]?.token as string;
    for (const s of servers.splice(0)) await s.close();

    const second = await boot({ store: await SqliteStore.open(path) });
    expect(second.server.rooms.has(code)).toBe(true);
    const back = second.client();
    await back.hello(code, { token });
    const after = await back.view((v) => v.phase === 'choosing');
    expect(after.me?.hand).toEqual(before?.me?.hand);
    // Gli altri risultano disconnessi finché non tornano.
    expect(after.players.filter((p) => p.connected)).toHaveLength(1);
  });
});
