import { minWhiteCards, type BlackCard, type WhiteCard } from '@cirelli/engine';
import type { Deck } from './schema.ts';

/** Chiave per riconoscere i doppioni fra mazzi diversi. */
export function dedupeKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('it')
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim();
}

/** Unisce più mazzi in carte per il motore, senza doppioni, con id stabili. */
export function combineDecks(decks: Deck[]): { black: BlackCard[]; white: WhiteCard[] } {
  const black: BlackCard[] = [];
  const white: WhiteCard[] = [];
  const seenBlack = new Set<string>();
  const seenWhite = new Set<string>();
  for (const deck of decks) {
    deck.black.forEach((c, i) => {
      const key = dedupeKey(c.text);
      if (seenBlack.has(key)) return;
      seenBlack.add(key);
      black.push({ id: `${deck.id}:b${i}`, text: c.text, pick: c.pick });
    });
    deck.white.forEach((c, i) => {
      const key = dedupeKey(c.text);
      if (seenWhite.has(key)) return;
      seenWhite.add(key);
      white.push({ id: `${deck.id}:w${i}`, text: c.text });
    });
  }
  return { black, white };
}

export const COMFORT_WHITE_PER_PLAYER = 20;
export const COMFORT_BLACK = 15;

export type DeckWarning = 'NOT_ENOUGH_WHITE' | 'NOT_ENOUGH_BLACK' | 'FEW_WHITE' | 'FEW_BLACK';

/**
 * Controllo in lobby. `blocking` impedisce l'avvio; gli altri avvisi segnalano che le carte
 * si ripeteranno presto.
 */
export function deckWarnings(
  counts: { black: number; white: number },
  players: number,
  handSize = 10,
): { blocking: boolean; warnings: DeckWarning[]; needed: number } {
  const warnings: DeckWarning[] = [];
  const needed = minWhiteCards(players, handSize);
  if (counts.black === 0) warnings.push('NOT_ENOUGH_BLACK');
  if (counts.white < needed) warnings.push('NOT_ENOUGH_WHITE');
  else if (counts.white < players * COMFORT_WHITE_PER_PLAYER) warnings.push('FEW_WHITE');
  if (counts.black > 0 && counts.black < COMFORT_BLACK) warnings.push('FEW_BLACK');
  return {
    blocking: warnings.includes('NOT_ENOUGH_WHITE') || warnings.includes('NOT_ENOUGH_BLACK'),
    warnings,
    needed,
  };
}
