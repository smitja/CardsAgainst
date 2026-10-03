import { CIRELLI_DECK } from './cirelli.ts';
import { DEMO_DECK } from './demo.ts';
import type { Deck } from './schema.ts';

/** Mazzi inclusi nel gioco, selezionabili in lobby per id. */
export const BUILTIN_DECKS: Readonly<Record<string, Deck>> = {
  cirelli: CIRELLI_DECK,
  demo: DEMO_DECK,
};

/** Mazzi attivi quando si crea una stanza. */
export const DEFAULT_DECKS: readonly string[] = ['cirelli'];

export const BUILTIN_DECK_ID = /^[a-z][a-z0-9-]{1,23}$/;
