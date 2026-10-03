import { describe, expect, it } from 'vitest';
import { DEMO_DECK, combineDecks, dedupeKey } from '../src/index.ts';

describe('mazzo demo', () => {
  it('ha trenta nere e cento bianche, tutte diverse', () => {
    expect(DEMO_DECK.black).toHaveLength(30);
    expect(DEMO_DECK.white).toHaveLength(100);
    expect(new Set(DEMO_DECK.white.map((c) => dedupeKey(c.text))).size).toBe(100);
    expect(new Set(DEMO_DECK.black.map((c) => dedupeKey(c.text))).size).toBe(30);
    const cards = combineDecks([DEMO_DECK]);
    expect(cards.white).toHaveLength(100);
  });

  it('mescola carte da una, due e tre risposte, anche senza spazi', () => {
    const picks = DEMO_DECK.black.map((c) => c.pick);
    expect(picks).toContain(2);
    expect(picks).toContain(3);
    expect(DEMO_DECK.black.some((c) => !c.text.includes('___'))).toBe(true);
  });

  it('non usa lineette lunghe', () => {
    const all = [...DEMO_DECK.black, ...DEMO_DECK.white].map((c) => c.text).join('\n');
    expect(all).not.toMatch(/[—–]/);
  });
});
