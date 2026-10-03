import { z } from 'zod';
import { countBlanks, guessKind, normalizeCardText, pickFor } from './text.ts';

export const DECK_SCHEMA_VERSION = 1;
export const MAX_BLACK = 2000;
export const MAX_WHITE = 5000;
export const MAX_BLACK_TEXT = 300;
export const MAX_WHITE_TEXT = 200;

const cardText = (max: number) =>
  z
    .string()
    .transform(normalizeCardText)
    .pipe(z.string().min(1, 'testo vuoto').max(max, `al massimo ${max} caratteri`));

export const BlackCardSchema = z
  .object({
    text: cardText(MAX_BLACK_TEXT).refine((t) => countBlanks(t) <= 3, 'al massimo tre spazi'),
    pick: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  // Il numero di carte si ricava sempre dal testo: un valore diverso viene corretto.
  .transform(({ text }) => ({ text, pick: pickFor(text) }));

export const WhiteCardSchema = z
  .object({
    text: cardText(MAX_WHITE_TEXT),
    kind: z.enum(['action', 'thing']).optional(),
  })
  // Senza categoria esplicita la si ricava dalla frase (verbo all'infinito o no).
  .transform(({ text, kind }) => ({ text, kind: kind ?? guessKind(text) }));

export const DeckSchema = z.object({
  schemaVersion: z.literal(DECK_SCHEMA_VERSION),
  id: z.string().min(1).max(64),
  name: z.string().transform(normalizeCardText).pipe(z.string().min(1).max(60)),
  language: z.string().min(2).max(10),
  description: z.string().max(300).optional(),
  black: z.array(BlackCardSchema).max(MAX_BLACK),
  white: z.array(WhiteCardSchema).max(MAX_WHITE),
});

export type DeckInput = z.input<typeof DeckSchema>;
export type Deck = z.output<typeof DeckSchema>;
export type DeckBlackCard = Deck['black'][number];
export type DeckWhiteCard = Deck['white'][number];

export function parseDeck(
  data: unknown,
): { ok: true; deck: Deck } | { ok: false; issues: string[] } {
  const res = DeckSchema.safeParse(data);
  if (res.success) return { ok: true, deck: res.data };
  return {
    ok: false,
    issues: res.error.issues.map((i) => `${i.path.join('.') || 'mazzo'}: ${i.message}`),
  };
}
