import { describe, expect, it } from 'vitest';
import {
  combineDecks,
  composeSentence,
  countBlanks,
  dedupeKey,
  deckWarnings,
  normalizeCardText,
  parseDeck,
  pickFor,
  segmentsOf,
  type DeckInput,
} from '../src/index.ts';

describe('testo delle carte', () => {
  it('normalizza spazi e trattini', () => {
    expect(normalizeCardText('  Il mio   ____ preferito\n è _____.  ')).toBe(
      'Il mio ___ preferito è ___.',
    );
    expect(normalizeCardText('un_trattino e __ due')).toBe('un_trattino e __ due');
  });

  it('conta gli spazi e ricava le carte da giocare', () => {
    expect(countBlanks('Niente spazi?')).toBe(0);
    expect(countBlanks('___ e ___ fanno ___.')).toBe(3);
    expect(pickFor('Niente spazi?')).toBe(1);
    expect(pickFor('___ batte ___.')).toBe(2);
    expect(pickFor('___ ___ ___ ___')).toBe(3);
  });

  it('divide la carta in pezzi e spazi', () => {
    expect(segmentsOf('___ batte ___.')).toEqual([
      { kind: 'blank', index: 0 },
      { kind: 'text', value: ' batte ' },
      { kind: 'blank', index: 1 },
      { kind: 'text', value: '.' },
    ]);
    expect(segmentsOf('Che cosa mi tiene sveglio?')).toEqual([
      { kind: 'text', value: 'Che cosa mi tiene sveglio?' },
      { kind: 'blank', index: 0 },
    ]);
  });

  it('compone la frase completa', () => {
    expect(
      composeSentence('Il mio terapeuta dice che il problema non sono io, ma ___.', [
        'il gruppo WhatsApp del condominio.',
      ]),
    ).toBe(
      'Il mio terapeuta dice che il problema non sono io, ma il gruppo WhatsApp del condominio.',
    );
    expect(composeSentence('___ batte ___.', ['la nonna', 'il wifi'])).toBe(
      'La nonna batte il wifi.',
    );
    expect(composeSentence('Che cosa mi tiene sveglio?', ['le bollette.'])).toBe(
      'Che cosa mi tiene sveglio? Le bollette.',
    );
    expect(composeSentence('Fine. ___ e poi ___', ['uno', 'due.'])).toBe('Fine. Uno e poi due.');
    expect(composeSentence('Chi è ___?', ['lui.'])).toBe('Chi è lui?');
    expect(composeSentence('___ batte ___.', ['la nonna'])).toBe('La nonna batte ___.');
  });
});

const deck = (over: Partial<DeckInput> = {}): DeckInput => ({
  schemaVersion: 1,
  id: 'demo',
  name: 'Demo',
  language: 'it',
  black: [{ text: 'Io e ___.' }, { text: '___ batte ___.', pick: 3 }],
  white: [{ text: 'il condominio' }, { text: 'mia zia' }],
  ...over,
});

describe('schema del mazzo', () => {
  it('accetta un mazzo valido e ricalcola pick dal testo', () => {
    const res = parseDeck(deck());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.deck.black.map((c) => c.pick)).toEqual([1, 2]);
  });

  it('rifiuta versioni, testi vuoti e troppi spazi', () => {
    const bad = [
      { ...deck(), schemaVersion: 2 },
      deck({ name: '   ' }),
      deck({ black: [{ text: '  ' }] }),
      deck({ black: [{ text: '___ ___ ___ ___' }] }),
      deck({ white: [{ text: 'x'.repeat(201) }] }),
      'non un mazzo',
    ];
    for (const b of bad) {
      const res = parseDeck(b);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('combinazione dei mazzi', () => {
  it('unisce senza doppioni e con id stabili', () => {
    const a = parseDeck(deck());
    const b = parseDeck(
      deck({ id: 'altro', white: [{ text: 'Mia  zia!' }, { text: 'il cugino' }], black: [] }),
    );
    if (!a.ok || !b.ok) throw new Error('mazzi non validi');
    const cards = combineDecks([a.deck, b.deck]);
    expect(cards.black.map((c) => c.id)).toEqual(['demo:b0', 'demo:b1']);
    expect(cards.white.map((c) => c.text)).toEqual(['il condominio', 'mia zia', 'il cugino']);
    expect(cards.white[2]?.id).toBe('altro:w1');
  });

  it('riconosce i doppioni a meno di maiuscole, accenti e punteggiatura', () => {
    expect(dedupeKey('Perché no?')).toBe(dedupeKey('perche  NO'));
  });

  it('avvisa se le carte non bastano', () => {
    expect(deckWarnings({ black: 30, white: 100 }, 5)).toEqual({
      blocking: false,
      warnings: [],
      needed: 55,
    });
    expect(deckWarnings({ black: 30, white: 100 }, 6).warnings).toEqual(['FEW_WHITE']);
    expect(deckWarnings({ black: 10, white: 100 }, 9)).toEqual({
      blocking: false,
      warnings: ['FEW_WHITE', 'FEW_BLACK'],
      needed: 99,
    });
    expect(deckWarnings({ black: 30, white: 100 }, 10).blocking).toBe(true);
    expect(deckWarnings({ black: 0, white: 500 }, 3)).toEqual({
      blocking: true,
      warnings: ['NOT_ENOUGH_BLACK'],
      needed: 33,
    });
  });
});
