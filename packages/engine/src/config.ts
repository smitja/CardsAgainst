import type { ConfigPatch, GameConfig } from './types.ts';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const MAX_NAME_LENGTH = 20;
export const MAX_BLANK_TEXT_LENGTH = 80;
export const MAX_CARDS = 5000;
export const GHOST_ID = 'ghost';
export const GHOST_NAME = 'Il Fantasma';

export const DEFAULT_CONFIG: GameConfig = {
  targetScore: 7,
  maxRounds: null,
  handSize: 10,
  ghost: false,
  handSwap: false,
  blankCards: 0,
  voting: false,
  choosingSeconds: null,
  judgingSeconds: null,
  dealMs: 1200,
  resultMs: 8000,
  judgeGraceMs: 20000,
  hostGraceMs: 15000,
  playerGraceMs: 20000,
};

const int = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : undefined;

const intOrNull = (v: unknown, min: number, max: number): number | null | undefined =>
  v === null ? null : int(v, min, max);

/** Applica solo i campi che l'host può cambiare, con limiti sensati. */
export function applyConfigPatch(config: GameConfig, patch: ConfigPatch): GameConfig {
  const next = { ...config };
  const p = patch as Record<string, unknown>;
  const targetScore = int(p.targetScore, 1, 50);
  if (targetScore !== undefined) next.targetScore = targetScore;
  const maxRounds = intOrNull(p.maxRounds, 1, 200);
  if (maxRounds !== undefined) next.maxRounds = maxRounds;
  const handSize = int(p.handSize, 5, 12);
  if (handSize !== undefined) next.handSize = handSize;
  const blankCards = int(p.blankCards, 0, 50);
  if (blankCards !== undefined) next.blankCards = blankCards;
  const choosingSeconds = intOrNull(p.choosingSeconds, 15, 300);
  if (choosingSeconds !== undefined) next.choosingSeconds = choosingSeconds;
  const judgingSeconds = intOrNull(p.judgingSeconds, 10, 300);
  if (judgingSeconds !== undefined) next.judgingSeconds = judgingSeconds;
  for (const key of ['ghost', 'handSwap', 'voting'] as const) {
    if (typeof p[key] === 'boolean') next[key] = p[key];
  }
  return next;
}

/** Carte bianche minime per iniziare: una mano a testa più una carta di scorta. */
export function minWhiteCards(players: number, handSize: number): number {
  return players * (handSize + 1);
}
