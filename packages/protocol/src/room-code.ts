/**
 * Codici stanza di quattro lettere, solo consonanti: niente lettere ambigue (I, O),
 * niente parole di senso compiuto da evitare. 20^4 = 160.000 combinazioni.
 */
export const ROOM_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_RE = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_ALPHABET[Math.floor(random() * ROOM_ALPHABET.length)];
  }
  return code;
}

/** Accetta quello che digita una persona: minuscole, spazi, trattini. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[^A-Z]/g, '');
  return ROOM_CODE_RE.test(code) ? code : null;
}
