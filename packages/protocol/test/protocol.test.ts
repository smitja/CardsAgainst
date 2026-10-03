import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  ROOM_ALPHABET,
  generateRoomCode,
  normalizeRoomCode,
  parseClientMessage,
} from '../src/index.ts';

describe('codici stanza', () => {
  it('genera quattro consonanti dall’alfabeto', () => {
    let seed = 0;
    const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(random);
      expect(code).toMatch(/^[A-Z]{4}$/);
      for (const ch of code) expect(ROOM_ALPHABET).toContain(ch);
    }
    expect(generateRoomCode()).toHaveLength(4);
  });

  it('normalizza quello che scrive una persona', () => {
    expect(normalizeRoomCode(' br-mt ')).toBe('BRMT');
    expect(normalizeRoomCode('BRM')).toBeNull();
    expect(normalizeRoomCode('BOMB')).toBeNull();
  });
});

describe('messaggi del client', () => {
  it('accetta i messaggi validi', () => {
    expect(
      parseClientMessage({
        t: 'hello',
        v: PROTOCOL_VERSION,
        room: 'BRMT',
        role: 'player',
        name: 'Anna',
      }),
    ).not.toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ t: 'intent', seq: 3, intent: { type: 'play', cards: ['demo:w1'] } }),
      ),
    ).toEqual({ t: 'intent', seq: 3, intent: { type: 'play', cards: ['demo:w1'] } });
    expect(
      parseClientMessage({
        t: 'intent',
        seq: 1,
        intent: { type: 'setDecks', decks: ['cirelli', 'demo', 'AB12CD'] },
      }),
    ).not.toBeNull();
    expect(
      parseClientMessage({
        t: 'intent',
        seq: 1,
        intent: { type: 'setConfig', config: { ghost: true } },
      }),
    ).not.toBeNull();
    expect(parseClientMessage({ t: 'ping', at: 5 })).toEqual({ t: 'ping', at: 5 });
  });

  it('rifiuta quelli malformati', () => {
    const bad = [
      'non json',
      '{"t":"hello"}',
      'x'.repeat(20_000),
      { t: 'hello', v: 99, room: 'BRMT', role: 'player' },
      { t: 'hello', v: PROTOCOL_VERSION, room: 'BOMB', role: 'player' },
      { t: 'intent', seq: -1, intent: { type: 'start' } },
      { t: 'intent', seq: 1, intent: { type: 'play', cards: [] } },
      { t: 'intent', seq: 1, intent: { type: 'boh' } },
      { t: 'intent', seq: 1, intent: { type: 'setConfig', config: { dealMs: 0 } } },
      { t: 'intent', seq: 1, intent: { type: 'setDecks', decks: ['Maiuscolo'] } },
      { t: 'intent', seq: 1, intent: { type: 'reveal', index: 1.5 } },
    ];
    for (const b of bad) expect(parseClientMessage(b)).toBeNull();
  });
});
