import { z } from 'zod';
import type { ErrorCode, GameView } from '@cirelli/engine';
import { ROOM_CODE_RE } from './room-code.ts';

export { PROTOCOL_VERSION } from './version.ts';
import { PROTOCOL_VERSION } from './version.ts';

const id = z.string().min(1).max(64);
const roomCode = z.string().regex(ROOM_CODE_RE);
export const DeckCodeSchema = z.string().regex(/^[A-Z0-9]{6}$/);
/** Mazzi inclusi nel gioco: id in minuscolo ("cirelli", "demo"). */
export const BuiltinDeckIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/);

export const ConfigPatchSchema = z
  .object({
    targetScore: z.number(),
    maxRounds: z.number().nullable(),
    handSize: z.number(),
    ghost: z.boolean(),
    handSwap: z.boolean(),
    blankCards: z.number(),
    voting: z.boolean(),
    choosingSeconds: z.number().nullable(),
    judgingSeconds: z.number().nullable(),
  })
  .partial()
  .strict();

/** Intenzioni dei giocatori: il server aggiunge chi le invia e l'ora. */
export const IntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('kick'), target: id }),
  z.object({ type: z.literal('transferHost'), to: id }),
  z.object({ type: z.literal('setConfig'), config: ConfigPatchSchema }),
  /** Mazzi scelti dall'host: "demo" o codici di condivisione. Li risolve il server. */
  z.object({
    type: z.literal('setDecks'),
    decks: z
      .array(z.union([BuiltinDeckIdSchema, DeckCodeSchema]))
      .min(1)
      .max(10),
  }),
  z.object({ type: z.literal('start') }),
  z.object({
    type: z.literal('play'),
    cards: z.array(id).min(1).max(3),
    blankTexts: z.record(z.string(), z.string().max(200)).optional(),
  }),
  z.object({ type: z.literal('retract') }),
  z.object({ type: z.literal('swapHand') }),
  z.object({ type: z.literal('reveal'), index: z.number().int().min(0).max(20) }),
  z.object({ type: z.literal('pick'), submission: id }),
  z.object({ type: z.literal('vote'), submission: id }),
  z.object({ type: z.literal('nextRound') }),
  z.object({ type: z.literal('rematch') }),
]);
export type Intent = z.infer<typeof IntentSchema>;

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    v: z.literal(PROTOCOL_VERSION),
    room: roomCode,
    role: z.enum(['player', 'screen']),
    /** Token salvato in localStorage: riprende lo stesso posto. */
    token: z.string().min(16).max(128).optional(),
    /** Nickname per un nuovo ingresso. */
    name: z.string().max(60).optional(),
  }),
  z.object({ t: z.literal('intent'), seq: z.number().int().min(0), intent: IntentSchema }),
  z.object({ t: z.literal('ping'), at: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerErrorCode =
  | 'BAD_MESSAGE'
  | 'VERSION'
  | 'ROOM_NOT_FOUND'
  | 'BAD_TOKEN'
  | 'NAME_REQUIRED'
  | 'RATE_LIMIT'
  | 'KICKED'
  | 'DECK_NOT_FOUND'
  | 'NOT_JOINED';

export interface DeckSummary {
  code: string;
  name: string;
  black: number;
  white: number;
}

/** Informazioni della stanza fuori dal motore: mazzi scelti in lobby. */
export interface RoomInfo {
  code: string;
  decks: DeckSummary[];
  /** Mazzi inclusi nel gioco, attivabili in lobby. */
  available: DeckSummary[];
}

export type ServerMessage =
  | { t: 'welcome'; room: string; seat: string | null; token: string | null; serverNow: number }
  | { t: 'state'; rev: number; view: GameView; room: RoomInfo }
  | { t: 'ack'; seq: number; ok: true }
  | { t: 'ack'; seq: number; ok: false; error: ErrorCode | ServerErrorCode }
  | { t: 'pong'; at: number; serverNow: number }
  | { t: 'error'; code: ServerErrorCode | ErrorCode; message: string };

/** Lettura difensiva di un messaggio dal client. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  let data = raw;
  if (typeof raw === 'string') {
    if (raw.length > 16_384) return null;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const res = ClientMessageSchema.safeParse(data);
  return res.success ? res.data : null;
}
