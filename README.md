# Cards Against Cirelli

Party game "completa la frase" da giocare in presenza, un telefono a testa.

Stato: Fase 3 (server delle stanze e client essenziale giocabile dall'inizio alla fine). Piano completo in `docs/PIANO.md`, direzione visiva in `docs/DIREZIONI.md`.

## Struttura

```
packages/engine     macchina a stati pura del gioco, senza dipendenze
packages/decks      schema dei mazzi, testo delle carte, combinazione dei mazzi
packages/protocol   messaggi client/server (zod) e codici stanza
apps/server         Node: file statici, API, WebSocket, stanze, SQLite/Postgres
apps/web            client Vite + React
e2e                 Playwright: quattro telefoni giocano una partita completa
```

## Comandi

```
pnpm install
pnpm test                                   # tutti i test
pnpm typecheck                              # TypeScript strict su tutto il monorepo
pnpm --filter @cirelli/engine coverage      # copertura del motore
pnpm build                                  # client in apps/web/dist, server in apps/server/dist/server.mjs
pnpm start                                  # gioco su http://localhost:3000
pnpm e2e                                    # build + test Playwright
```

Sviluppo: `pnpm --filter @cirelli/server dev` (porta 3000) e `pnpm --filter @cirelli/web dev` (Vite, con proxy verso il server).

Variabili del server: `PORT` (3000), `HOST`, `STATIC_DIR` (apps/web/dist), `SQLITE_PATH` (data/cirelli.db), `DATABASE_URL` (se inizia con `postgres` usa Postgres al posto di SQLite).
