# Cards Against Cirelli

Party game "completa la frase" da giocare in presenza, un telefono a testa.

Stato: Fase 2 (motore di gioco puro e testato). Piano completo in `docs/PIANO.md`, direzione visiva in `docs/DIREZIONI.md`.

## Struttura

```
packages/engine     macchina a stati pura del gioco, senza dipendenze
packages/decks      schema dei mazzi, testo delle carte, combinazione dei mazzi
packages/protocol   messaggi client/server (zod) e codici stanza
```

## Comandi

```
pnpm install
pnpm test                                   # tutti i test
pnpm typecheck                              # TypeScript strict su tutto il monorepo
pnpm --filter @cirelli/engine coverage      # copertura del motore
```
