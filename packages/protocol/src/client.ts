/** Ingresso leggero per il browser: niente zod, solo costanti, codici stanza e tipi. */
export * from './room-code.ts';
export { PROTOCOL_VERSION } from './version.ts';
export type {
  ClientMessage,
  DeckSummary,
  Intent,
  RoomInfo,
  ServerErrorCode,
  ServerMessage,
} from './messages.ts';
