import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startServer } from './server.ts';
import { SqliteStore, type Store } from './store.ts';

async function openStore(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (url?.startsWith('postgres')) {
    const { PostgresStore } = await import('./postgres.ts');
    return PostgresStore.open(url);
  }
  const path = resolve(process.env.SQLITE_PATH ?? 'data/cirelli.db');
  mkdirSync(dirname(path), { recursive: true });
  return SqliteStore.open(path);
}

const store = await openStore();
const server = await startServer({
  store,
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  staticDir: process.env.STATIC_DIR ?? resolve('apps/web/dist'),
});
console.log(`Cards Against Cirelli in ascolto sulla porta ${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close();
    await store.close();
    process.exit(0);
  });
}
