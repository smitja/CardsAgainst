export type SeatId = string;
export type CardId = string;
export type SubmissionId = string;
export type PickCount = 1 | 2 | 3;

export interface BlackCard {
  id: CardId;
  text: string;
  /** Numero di carte bianche da giocare. Con zero spazi nel testo vale 1 e la risposta va in coda. */
  pick: PickCount;
}

export interface WhiteCard {
  id: CardId;
  text: string;
  /** Carta jolly: il testo lo scrive chi la gioca. */
  blank?: true;
}

/**
 * lobby → dealing → choosing → revealing → judging → result → (dealing | ended).
 * `paused` quando restano meno di tre giocatori umani attivi.
 */
export type Phase =
  'lobby' | 'dealing' | 'choosing' | 'revealing' | 'judging' | 'result' | 'paused' | 'ended';

export interface GameConfig {
  targetScore: number;
  maxRounds: number | null;
  handSize: number;
  /** Giocatore fantasma che gioca carte a caso. */
  ghost: boolean;
  /** Scambio della mano al costo di un punto. */
  handSwap: boolean;
  /** Quante carte jolly aggiungere al mazzo bianco. 0 = regola spenta. */
  blankCards: number;
  /** Voto collettivo al posto del giudice. */
  voting: boolean;
  choosingSeconds: number | null;
  judgingSeconds: number | null;
  /** Durata della distribuzione (animazione). 0 = si passa subito alla scelta. */
  dealMs: number;
  /** Dopo quanto il risultato passa da solo al round successivo. null = solo a mano. */
  resultMs: number | null;
  judgeGraceMs: number;
  hostGraceMs: number;
  playerGraceMs: number;
}

export type PlayerKind = 'human' | 'ghost';
/** `waiting`: entrato a partita in corso, gioca dal round successivo. */
export type PlayerStatus = 'active' | 'waiting';

export interface Player {
  id: SeatId;
  name: string;
  kind: PlayerKind;
  status: PlayerStatus;
  connected: boolean;
  disconnectedAt: number | null;
  /** Ordine d'ingresso: guida la rotazione del giudice e la migrazione dell'host. */
  order: number;
  score: number;
  hand: CardId[];
}

export interface Submission {
  id: SubmissionId;
  by: SeatId;
  cards: CardId[];
  /** Testi risolti, compreso quello scritto sulle carte jolly. */
  texts: string[];
}

export type RoundOutcome = 'won' | 'noWinner' | 'voided';
export type VoidReason = 'judgeLeft' | 'fewAnswers' | 'notEnoughPlayers';

export interface Round {
  number: number;
  judge: SeatId | null;
  black: CardId;
  participants: SeatId[];
  submissions: Submission[];
  /** Ordine di rivelazione, mescolato. */
  order: SubmissionId[];
  revealed: number;
  votes: Record<SeatId, SubmissionId>;
  winners: SeatId[];
  winningSubmissions: SubmissionId[];
  outcome: RoundOutcome | null;
  voidReason: VoidReason | null;
}

export type EndReason = 'target' | 'rounds' | 'deck';

export interface GameState {
  v: 1;
  phase: Phase;
  config: GameConfig;
  players: Player[];
  hostId: SeatId | null;
  cards: { black: Record<CardId, BlackCard>; white: Record<CardId, WhiteCard> };
  piles: {
    blackDraw: CardId[];
    blackDiscard: CardId[];
    whiteDraw: CardId[];
    whiteDiscard: CardId[];
  };
  round: Round | null;
  roundsPlayed: number;
  roundCounter: number;
  lastJudgeOrder: number | null;
  deadline: number | null;
  rng: number;
  seq: number;
  winners: SeatId[];
  endReason: EndReason | null;
}

export type ConfigPatch = Partial<
  Pick<
    GameConfig,
    | 'targetScore'
    | 'maxRounds'
    | 'handSize'
    | 'ghost'
    | 'handSwap'
    | 'blankCards'
    | 'voting'
    | 'choosingSeconds'
    | 'judgingSeconds'
  >
>;

/** Eventi di sistema (dal server) e intenzioni dei giocatori (`by`). Tutti portano il tempo. */
export type Input =
  | { type: 'join'; seat: SeatId; name: string; now: number }
  | { type: 'connect'; seat: SeatId; now: number }
  | { type: 'disconnect'; seat: SeatId; now: number }
  | { type: 'tick'; now: number }
  | { type: 'leave'; by: SeatId; now: number }
  | { type: 'kick'; by: SeatId; target: SeatId; now: number }
  | { type: 'transferHost'; by: SeatId; to: SeatId; now: number }
  | { type: 'setConfig'; by: SeatId; config: ConfigPatch; now: number }
  | { type: 'loadCards'; by: SeatId; black: BlackCard[]; white: WhiteCard[]; now: number }
  | { type: 'start'; by: SeatId; now: number }
  | {
      type: 'play';
      by: SeatId;
      cards: CardId[];
      blankTexts?: Record<CardId, string>;
      now: number;
    }
  | { type: 'retract'; by: SeatId; now: number }
  | { type: 'swapHand'; by: SeatId; now: number }
  | { type: 'reveal'; by: SeatId; index: number; now: number }
  | { type: 'pick'; by: SeatId; submission: SubmissionId; now: number }
  | { type: 'vote'; by: SeatId; submission: SubmissionId; now: number }
  | { type: 'nextRound'; by: SeatId; now: number }
  | { type: 'rematch'; by: SeatId; now: number };

export type ErrorCode =
  | 'WRONG_PHASE'
  | 'NOT_HOST'
  | 'UNKNOWN_PLAYER'
  | 'SEAT_TAKEN'
  | 'BAD_NAME'
  | 'ROOM_FULL'
  | 'BAD_TARGET'
  | 'BAD_CARDS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_ENOUGH_CARDS'
  | 'NOT_PARTICIPANT'
  | 'ALREADY_PLAYED'
  | 'NOT_PLAYED'
  | 'BAD_TEXT'
  | 'RULE_DISABLED'
  | 'NO_POINTS'
  | 'NOT_ALLOWED'
  | 'BAD_INDEX'
  | 'UNKNOWN_SUBMISSION'
  | 'OWN_SUBMISSION';

export type GameEvent =
  | { type: 'playerJoined'; seat: SeatId }
  | { type: 'playerLeft'; seat: SeatId; kicked: boolean }
  | { type: 'hostChanged'; seat: SeatId }
  | { type: 'gameStarted' }
  | { type: 'roundStarted'; round: number; judge: SeatId | null }
  | { type: 'choosingStarted' }
  | { type: 'played'; seat: SeatId }
  | { type: 'retracted'; seat: SeatId }
  | { type: 'handSwapped'; seat: SeatId }
  | { type: 'revealStarted' }
  | { type: 'revealed'; index: number }
  | { type: 'judgingStarted' }
  | { type: 'voted'; seat: SeatId }
  | { type: 'roundWon'; winners: SeatId[]; submissions: SubmissionId[] }
  | { type: 'roundNoWinner' }
  | { type: 'roundVoided'; reason: VoidReason }
  | { type: 'paused' }
  | { type: 'reshuffled'; pile: 'black' | 'white' }
  | { type: 'gameEnded'; winners: SeatId[]; reason: EndReason }
  | { type: 'backToLobby' };

export type Result =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: ErrorCode; state: GameState };
