import type {
  BlackCard,
  CardId,
  EndReason,
  GameConfig,
  GameState,
  Phase,
  PlayerKind,
  PlayerStatus,
  RoundOutcome,
  SeatId,
  SubmissionId,
  VoidReason,
  WhiteCard,
} from './types.ts';

export interface PublicPlayer {
  id: SeatId;
  name: string;
  kind: PlayerKind;
  status: PlayerStatus;
  connected: boolean;
  score: number;
  isHost: boolean;
  isJudge: boolean;
  /** Partecipa al round in corso (gioca carte). */
  inRound: boolean;
  played: boolean;
  voted: boolean;
}

export interface PublicSubmission {
  id: SubmissionId;
  texts: string[];
  /** Autore: visibile solo per le risposte vincitrici, nel risultato. */
  author: SeatId | null;
  /** Voti ricevuti: solo nel risultato con voto collettivo. */
  votes: number | null;
  winner: boolean;
}

export interface RoundView {
  number: number;
  judge: SeatId | null;
  black: BlackCard;
  participants: number;
  played: number;
  /** Risposte totali da svelare (noto da `revealing` in poi). */
  total: number;
  revealed: number;
  /** In ordine di rivelazione: solo quelle già svelate. */
  submissions: PublicSubmission[];
  votes: number;
  outcome: RoundOutcome | null;
  voidReason: VoidReason | null;
  winners: SeatId[];
}

export interface MeView {
  id: SeatId;
  hand: WhiteCard[];
  submission: { id: SubmissionId; cards: CardId[]; texts: string[] } | null;
  vote: SubmissionId | null;
}

export interface GameView {
  v: 1;
  phase: Phase;
  config: GameConfig;
  hostId: SeatId | null;
  players: PublicPlayer[];
  round: RoundView | null;
  deadline: number | null;
  roundsPlayed: number;
  winners: SeatId[];
  endReason: EndReason | null;
  deck: { black: number; white: number };
  me: MeView | null;
}

/**
 * Proiezione dello stato per un giocatore (o per lo schermo condiviso con `seat = null`).
 * Contiene solo la mano di chi guarda e solo le risposte già svelate, sempre anonime
 * tranne quelle vincitrici nel risultato.
 */
export function viewFor(state: GameState, seat: SeatId | null): GameView {
  const round = state.round;
  const me = seat ? state.players.find((p) => p.id === seat && p.kind === 'human') : undefined;
  const showVotes = state.config.voting && state.phase === 'result';

  let roundView: RoundView | null = null;
  if (round) {
    const voteCounts = new Map<SubmissionId, number>();
    for (const sid of Object.values(round.votes)) {
      voteCounts.set(sid, (voteCounts.get(sid) ?? 0) + 1);
    }
    const visible = round.order.slice(
      0,
      state.phase === 'revealing' ? round.revealed : round.order.length,
    );
    const submissions: PublicSubmission[] = [];
    for (const sid of visible) {
      const s = round.submissions.find((x) => x.id === sid);
      if (!s) continue;
      const winner = round.winningSubmissions.includes(s.id);
      submissions.push({
        id: s.id,
        texts: [...s.texts],
        author: state.phase === 'result' && winner ? s.by : null,
        votes: showVotes ? (voteCounts.get(s.id) ?? 0) : null,
        winner,
      });
    }
    roundView = {
      number: round.number,
      judge: round.judge,
      black: { ...(state.cards.black[round.black] as BlackCard) },
      participants: round.participants.length,
      played: round.submissions.length,
      total: round.order.length,
      revealed: round.revealed,
      submissions,
      votes: Object.keys(round.votes).length,
      outcome: round.outcome,
      voidReason: round.voidReason,
      winners: [...round.winners],
    };
  }

  const players: PublicPlayer[] = [...state.players]
    .sort((a, b) => a.order - b.order)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      status: p.status,
      connected: p.connected,
      score: p.score,
      isHost: state.hostId === p.id,
      isJudge: round?.judge === p.id,
      inRound: round?.participants.includes(p.id) ?? false,
      played: round?.submissions.some((s) => s.by === p.id) ?? false,
      voted: round?.votes[p.id] !== undefined,
    }));

  let meView: MeView | null = null;
  if (me) {
    const sub = round?.submissions.find((s) => s.by === me.id);
    meView = {
      id: me.id,
      hand: me.hand.map((id) => ({ ...(state.cards.white[id] as WhiteCard) })),
      submission: sub ? { id: sub.id, cards: [...sub.cards], texts: [...sub.texts] } : null,
      vote: round?.votes[me.id] ?? null,
    };
  }

  return {
    v: 1,
    phase: state.phase,
    config: { ...state.config },
    hostId: state.hostId,
    players,
    round: roundView,
    deadline: state.deadline,
    roundsPlayed: state.roundsPlayed,
    winners: [...state.winners],
    endReason: state.endReason,
    deck: {
      black: Object.keys(state.cards.black).length,
      white: Object.values(state.cards.white).filter((c) => !c.blank).length,
    },
    me: meView,
  };
}
