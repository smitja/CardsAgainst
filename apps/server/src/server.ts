import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameConfig } from '@cirelli/engine';
import {
  generateRoomCode,
  normalizeRoomCode,
  parseClientMessage,
  type ServerMessage,
} from '@cirelli/protocol';
import { Room, type Conn } from './room.ts';
import type { Store } from './store.ts';

export interface ServerOptions {
  store: Store;
  port?: number;
  host?: string;
  /** Cartella con la build del client (index.html e assets). */
  staticDir?: string | null;
  timings?: Partial<GameConfig>;
  now?: () => number;
  /** Dopo quanto una stanza vuota viene eliminata. */
  idleRoomMs?: number;
}

const MAX_MESSAGE_BYTES = 16 * 1024;
const RATE_CAPACITY = 30;
const RATE_PER_SECOND = 10;
const HEARTBEAT_MS = 25_000;

export async function startServer(opts: ServerOptions) {
  const now = opts.now ?? Date.now;
  const rooms = new Map<string, Room>();
  const idleRoomMs = opts.idleRoomMs ?? 2 * 60 * 60 * 1000;
  const deps = {
    store: opts.store,
    now,
    resolveDeck: async (code: string) => (await opts.store.getDeck(code))?.deck ?? null,
  };

  for (const snap of await opts.store.loadRooms()) {
    const room = new Room(snap.code, deps, opts.timings, snap);
    rooms.set(snap.code, room);
    room.markAllDisconnected();
  }

  function createRoom(): Room {
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode();
      if (rooms.has(code)) continue;
      const room = new Room(code, deps, opts.timings);
      rooms.set(code, room);
      return room;
    }
    throw new Error('nessun codice stanza libero');
  }

  const creations = new Map<string, number[]>();
  function allowCreation(ip: string): boolean {
    const t = now();
    const recent = (creations.get(ip) ?? []).filter((x) => t - x < 60_000);
    recent.push(t);
    creations.set(ip, recent);
    return recent.length <= 20;
  }

  const http = createHttpServer((req, res) => {
    handleHttp(req, res).catch((e: unknown) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'INTERNAL' });
      else res.end();
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size });

    if (path === '/api/rooms' && req.method === 'POST') {
      const ip = req.socket.remoteAddress ?? '?';
      if (!allowCreation(ip)) return json(res, 429, { error: 'RATE_LIMIT' });
      const room = createRoom();
      await opts.store.saveRoom(room.snapshot());
      return json(res, 201, { code: room.code });
    }

    const match = /^\/api\/rooms\/([^/]+)$/.exec(path);
    if (match && req.method === 'GET') {
      const code = normalizeRoomCode(decodeURIComponent(match[1] ?? ''));
      const room = code ? rooms.get(code) : undefined;
      if (!room) return json(res, 404, { error: 'ROOM_NOT_FOUND' });
      const humans = room.state.players.filter((p) => p.kind === 'human');
      return json(res, 200, {
        code: room.code,
        phase: room.state.phase,
        players: humans.length,
        full: humans.length >= 10,
      });
    }

    if (path.startsWith('/api/')) return json(res, 404, { error: 'NOT_FOUND' });
    return serveStatic(opts.staticDir ?? null, path, res);
  }

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let alive = true;
    let tokens = RATE_CAPACITY;
    let refilledAt = now();

    const conn: Conn = {
      seat: null,
      role: null,
      send: (msg: ServerMessage) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: (code, reason) => ws.close(code, reason),
    };

    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    ws.on('message', (data) => {
      const t = now();
      tokens = Math.min(RATE_CAPACITY, tokens + ((t - refilledAt) / 1000) * RATE_PER_SECOND);
      refilledAt = t;
      if (tokens < 1) {
        conn.send({ t: 'error', code: 'RATE_LIMIT', message: 'RATE_LIMIT' });
        return;
      }
      tokens -= 1;

      const msg = parseClientMessage(data.toString());
      if (!msg) {
        conn.send({ t: 'error', code: 'BAD_MESSAGE', message: 'BAD_MESSAGE' });
        return;
      }
      if (msg.t === 'hello') {
        if (room) return;
        const found = rooms.get(msg.room);
        if (!found) {
          conn.send({ t: 'error', code: 'ROOM_NOT_FOUND', message: 'ROOM_NOT_FOUND' });
          ws.close(4004, 'ROOM_NOT_FOUND');
          return;
        }
        room = found;
      }
      if (!room) {
        conn.send({ t: 'error', code: 'NOT_JOINED', message: 'NOT_JOINED' });
        return;
      }
      room.handle(conn, msg).catch((e: unknown) => console.error(e));
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      room?.detach(conn);
    });
  });

  const sweeper = setInterval(() => {
    const t = now();
    for (const [code, room] of rooms) {
      if (room.isEmpty && t - room.lastActivity > idleRoomMs) {
        room.dispose();
        rooms.delete(code);
        void opts.store.deleteRoom(code);
      }
    }
  }, 60_000);
  sweeper.unref?.();

  await new Promise<void>((ok) => http.listen(opts.port ?? 0, opts.host ?? '0.0.0.0', ok));
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    port,
    rooms,
    createRoom,
    async close() {
      clearInterval(sweeper);
      for (const room of rooms.values()) {
        await room.flush();
        room.dispose();
      }
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((ok) => wss.close(() => ok()));
      await new Promise<void>((ok) => http.close(() => ok()));
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(dir: string | null, path: string, res: ServerResponse) {
  if (!dir) return json(res, 404, { error: 'NOT_FOUND' });
  const root = resolve(dir);
  const target = normalize(join(root, decodeURIComponent(path)));
  const safe = target === root || target.startsWith(root + sep);
  let file = safe ? target : join(root, 'index.html');
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    // Rotte della SPA (/r/BRMT, /tv/BRMT...): risponde index.html.
    file = join(root, 'index.html');
  }
  const ext = extname(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(file)
    .on('error', () => res.end())
    .pipe(res);
}
