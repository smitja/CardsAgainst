/** Testi degli errori, scritti dal punto di vista di chi gioca. */
const ERRORS: Record<string, string> = {
  ROOM_NOT_FOUND: 'Questa stanza non esiste o è stata chiusa.',
  KICKED: 'L’host ti ha tolto dalla stanza.',
  NAME_REQUIRED: 'Scegli un nickname per entrare.',
  BAD_TOKEN: 'Il tuo posto non c’è più. Rientra con un nickname.',
  ROOM_FULL: 'La stanza è piena: al massimo dieci giocatori.',
  BAD_NAME: 'Quel nickname non va bene. Prova con un altro.',
  VERSION: 'Il gioco è stato aggiornato. Ricarica la pagina.',
  LEFT: 'Sei uscito dalla stanza.',
  NOT_HOST: 'Lo può fare solo chi ha creato la stanza.',
  WRONG_PHASE: 'Troppo tardi: il gioco è già andato avanti.',
  NOT_ENOUGH_PLAYERS: 'Servono almeno tre giocatori.',
  NOT_ENOUGH_CARDS: 'Le carte bianche non bastano per tutti. Aggiungi un mazzo.',
  NOT_PARTICIPANT: 'In questo round non giochi carte.',
  ALREADY_PLAYED: 'Hai già giocato in questo round.',
  BAD_CARDS: 'Scegli il numero giusto di carte.',
  BAD_TEXT: 'Scrivi qualcosa sulla carta jolly (massimo 80 caratteri).',
  NO_POINTS: 'Per cambiare mano serve almeno un punto.',
  RULE_DISABLED: 'Questa regola non è attiva.',
  NOT_ALLOWED: 'Non tocca a te.',
  OWN_SUBMISSION: 'Non puoi votare la tua risposta.',
  DECK_NOT_FOUND: 'Non trovo un mazzo con quel codice.',
  RATE_LIMIT: 'Piano, un tocco alla volta.',
};

export const errorText = (code: string) => ERRORS[code] ?? 'Qualcosa è andato storto. Riprova.';

export const VOID_REASON: Record<string, string> = {
  judgeLeft: 'Il giudice è sparito: round annullato, le carte tornano in mano.',
  fewAnswers: 'Troppe poche risposte: round annullato, le carte tornano in mano.',
  notEnoughPlayers: 'Siamo rimasti in pochi: round annullato.',
};
