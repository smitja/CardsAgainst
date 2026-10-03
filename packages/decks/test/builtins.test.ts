import { describe, expect, it } from 'vitest';
import {
  BUILTIN_DECKS,
  CIRELLI_DECK,
  DEFAULT_DECKS,
  combineDecks,
  composeSentence,
  dedupeKey,
  fitAnswer,
} from '../src/index.ts';

describe('mazzo di casa', () => {
  it('è il mazzo predefinito, con le 202 bianche dei PDF senza doppioni', () => {
    expect(DEFAULT_DECKS).toEqual(['cirelli']);
    expect(BUILTIN_DECKS.cirelli).toBe(CIRELLI_DECK);
    expect(CIRELLI_DECK.white).toHaveLength(202);
    expect(new Set(CIRELLI_DECK.white.map((c) => dedupeKey(c.text))).size).toBe(202);
    expect(CIRELLI_DECK.black.length).toBeGreaterThanOrEqual(30);
  });

  it('non contiene più i glifi sbagliati dell’estrazione', () => {
    const all = CIRELLI_DECK.white.map((c) => c.text).join('\n');
    expect(all).not.toMatch(/`|I’occhioIino/);
    expect(all).toContain('Fare l’occhiolino a persone anziane');
  });

  it('si combina con il mazzo base senza duplicare le nere', () => {
    const cards = combineDecks([CIRELLI_DECK, BUILTIN_DECKS.demo as typeof CIRELLI_DECK]);
    expect(cards.white).toHaveLength(302);
    expect(cards.black).toHaveLength(CIRELLI_DECK.black.length);
  });
});

describe('maiuscole a metà frase', () => {
  it('abbassa infiniti e articoli, lascia nomi propri e sigle', () => {
    expect(fitAnswer('Brindare alla figa', 'Ho lasciato il lavoro per ', '.')).toBe(
      'brindare alla figa',
    );
    expect(fitAnswer('Il KKK', 'vietato ', '.')).toBe('il KKK');
    expect(fitAnswer('L’acquario di Alessandro Federici.', 'ma ', '.')).toBe(
      'l’acquario di Alessandro Federici',
    );
    expect(fitAnswer('Andrea Bocelli', 'ma ', '.')).toBe('Andrea Bocelli');
    expect(fitAnswer('KKK', 'ma ', '.')).toBe('KKK');
    expect(fitAnswer('10 incredibili curiosità', 'ma ', '.')).toBe('10 incredibili curiosità');
    expect(fitAnswer('Farsi leggere i tarocchi', 'tempo pieno a ', '.')).toBe(
      'farsi leggere i tarocchi',
    );
  });

  it('a inizio frase resta maiuscola', () => {
    expect(composeSentence('___: il motivo.', ['brindare alla figa'])).toBe(
      'Brindare alla figa: il motivo.',
    );
  });
});
