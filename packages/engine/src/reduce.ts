import {
  DEFAULT_CONFIG,
  GHOST_ID,
  GHOST_NAME,
  MAX_BLANK_TEXT_LENGTH,
  MAX_CARDS,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyConfigPatch,
  minWhiteCards,
} from './config.ts';
import { nextRandom } from './rng.ts';
import type {
  BlackCard,
  CardId,
  EndReason,
  ErrorCode,
  GameConfig,
  GameEvent,
  GameState,
  Input,
  Phase,
  Player,
  Result,
  Round,
  SeatId,
  Submission,
  SubmissionId,
  VoidReason,
  WhiteCard,
} from './types.ts';

/** Disponibile in Node 17+ e in tutti i browser moderni; dichiarato qui per restare senza dipendenze. */
declare const structuredClone: <T>(value: T) => T;

interface Ctx {
  d: GameState;
  now: number;
  events: GameEvent[];
}

class EngineError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

function fail(code: ErrorCode): never {
  throw new EngineError(code);
}

const ROUND_PHASES: readonly Phase[] = ['dealing', 'choosing', 'revealing', 'judging'];

export function createGame(seed: number, config: Partial<GameConfig> = {}): GameState {
  return {
    v: 1,
    phase: 'lobby',
    config: { ...DEFAULT_CONFIG, ...config },
    players: [],
    hostId: null,
    cards: { black: {}, white: {} },
    piles: { blackDraw: [], blackDiscard: [], whiteDraw: [], whiteDiscard: [] },
    round: null,
    roundsPlayed: 0,
    roundCounter: 0,
    lastJudgeOrder: null,
    deadline: null,
    rng: seed >>> 0,
    seq: 0,
    winners: [],
    endReason: null,
  };
}

/** Applica un input. Non modifica lo stato ricevuto; in caso di errore restituisce lo stato invariato. */
export function reduce(state: GameState, input: Input): Result {
  const ctx: Ctx = { d: structuredClone(state), now: input.now, events: [] };
  try {
    handle(ctx, input);
  } catch (e) {
    if (e instanceof EngineError) return { ok: false, error: e.code, state };
    throw e;
  }
  return { ok: true, state: ctx.d, events: ctx.events };
}

function handle(ctx: Ctx, input: Input): void {
  switch (input.type) {
    case 'join':
      return join(ctx, input.seat, input.name);
    case 'connect':
      return setConnected(ctx, input.seat, true);
    case 'disconnect':
      return setConnected(ctx, input.seat, false);
    case 'tick':
      return tick(ctx);
    case 'leave':
      return removePlayer(ctx, input.by, false);
    case 'kick':
      requireHost(ctx, input.by);
      if (input.target === input.by) fail('BAD_TARGET');
      return removePlayer(ctx, input.target, true);
    case 'transferHost':
      return transferHost(ctx, input.by, input.to);
    case 'setConfig':
      requireHost(ctx, input.by);
      requirePhase(ctx, 'lobby');
      ctx.d.config = applyConfigPatch(ctx.d.config, input.config);
      return;
    case 'loadCards':
      return loadCards(ctx, input.by, input.black, input.white);
    case 'start':
      return start(ctx, input.by);
    case 'play':
      return play(ctx, input.by, input.cards, input.blankTexts);
    case 'retract':
      return retract(ctx, input.by);
    case 'swapHand':
      return swapHand(ctx, input.by);
    case 'reveal':
      return reveal(ctx, input.by, input.index);
    case 'pick':
      return pick(ctx, input.by, input.submission);
    case 'vote':
      return vote(ctx, input.by, input.submission);
    case 'nextRound':
      return nextRound(ctx, input.by);
    case 'rematch':
      return rematch(ctx, input.by);
  }
}

/* ------------------------------------------------------------------ utilità */

function rand(d: GameState): number {
  const [value, next] = nextRandom(d.rng);
  d.rng = next;
  return value;
}

function shuffle<T>(d: GameState, items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(d) * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

const byOrder = (a: Player, b: Player) => a.order - b.order;

function findPlayer(d: GameState, id: SeatId | null | undefined): Player | undefined {
  return id == null ? undefined : d.players.find((p) => p.id === id);
}

function requirePlayer(ctx: Ctx, id: SeatId): Player {
  return findPlayer(ctx.d, id) ?? fail('UNKNOWN_PLAYER');
}

function requireHost(ctx: Ctx, by: SeatId): void {
  if (ctx.d.hostId !== by) fail('NOT_HOST');
}

function requirePhase(ctx: Ctx, ...phases: Phase[]): void {
  if (!phases.includes(ctx.d.phase)) fail('WRONG_PHASE');
}

function requireRound(ctx: Ctx): Round {
  return ctx.d.round ?? fail('WRONG_PHASE');
}

function humans(d: GameState): Player[] {
  return d.players.filter((p) => p.kind === 'human').sort(byOrder);
}

function activeHumans(d: GameState): Player[] {
  return humans(d).filter((p) => p.status === 'active');
}

/** Presente = connesso, oppure disconnesso da meno del periodo di tolleranza. */
function isPresent(ctx: Ctx, p: Player): boolean {
  if (p.kind === 'ghost' || p.connected) return true;
  return p.disconnectedAt !== null && ctx.now - p.disconnectedAt < ctx.d.config.playerGraceMs;
}

function submissionOf(round: Round, seat: SeatId): Submission | undefined {
  return round.submissions.find((s) => s.by === seat);
}

/** Testo libero pulito: niente caratteri di controllo, spazi compressi. Oltre `max` si rifiuta o si tronca. */
function cleanText(raw: unknown, max: number, truncate = false): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const chars = [...text];
  if (chars.length <= max) return text;
  return truncate ? chars.slice(0, max).join('').trimEnd() : null;
}

function newSubmissionId(d: GameState): SubmissionId {
  for (;;) {
    const id =
      's' +
      Math.floor(rand(d) * 36 ** 6)
        .toString(36)
        .padStart(6, '0');
    if (!d.round?.submissions.some((s) => s.id === id)) return id;
  }
}

function setHost(ctx: Ctx, seat: SeatId | null): void {
  if (ctx.d.hostId === seat) return;
  ctx.d.hostId = seat;
  if (seat) ctx.events.push({ type: 'hostChanged', seat });
}

function setDeadline(ctx: Ctx, ms: number | null): void {
  ctx.d.deadline = ms === null ? null : ctx.now + ms;
}

/* ----------------------------------------------------------------- mazzo */

function drawWhite(ctx: Ctx, n: number): CardId[] {
  const { piles } = ctx.d;
  const out: CardId[] = [];
  while (out.length < n) {
    if (piles.whiteDraw.length === 0) {
      if (piles.whiteDiscard.length === 0) break;
      piles.whiteDraw = shuffle(ctx.d, piles.whiteDiscard);
      piles.whiteDiscard = [];
      ctx.events.push({ type: 'reshuffled', pile: 'white' });
    }
    out.push(piles.whiteDraw.pop() as CardId);
  }
  return out;
}

function drawBlack(ctx: Ctx): CardId | null {
  const { piles } = ctx.d;
  if (piles.blackDraw.length === 0 && piles.blackDiscard.length > 0) {
    piles.blackDraw = shuffle(ctx.d, piles.blackDiscard);
    piles.blackDiscard = [];
    ctx.events.push({ type: 'reshuffled', pile: 'black' });
  }
  return piles.blackDraw.pop() ?? null;
}

function blackOf(ctx: Ctx, round: Round): BlackCard {
  return ctx.d.cards.black[round.black] as BlackCard;
}

/* ------------------------------------------------------------- giocatori */

function join(ctx: Ctx, seat: SeatId, rawName: string): void {
  const { d } = ctx;
  if (seat === GHOST_ID || findPlayer(d, seat)) fail('SEAT_TAKEN');
  const clean = cleanText(rawName, MAX_NAME_LENGTH, true);
  if (!clean) fail('BAD_NAME');
  if (humans(d).length >= MAX_PLAYERS) fail('ROOM_FULL');
  const status = d.phase === 'lobby' || d.phase === 'ended' ? 'active' : 'waiting';
  d.seq += 1;
  d.players.push({
    id: seat,
    name: uniqueName(d, clean),
    kind: 'human',
    status,
    connected: true,
    disconnectedAt: null,
    order: d.seq,
    score: 0,
    hand: [],
  });
  ctx.events.push({ type: 'playerJoined', seat });
  if (!d.hostId) setHost(ctx, seat);
  if (d.phase === 'paused' && humans(d).length >= MIN_PLAYERS) startRound(ctx);
}

function uniqueName(d: GameState, name: string): string {
  const taken = new Set(d.players.map((p) => p.name.toLocaleLowerCase('it')));
  if (!taken.has(name.toLocaleLowerCase('it'))) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = [...name].slice(0, MAX_NAME_LENGTH - suffix.length).join('') + suffix;
    if (!taken.has(candidate.toLocaleLowerCase('it'))) return candidate;
  }
}

function setConnected(ctx: Ctx, seat: SeatId, connected: boolean): void {
  const p = requirePlayer(ctx, seat);
  if (p.kind === 'ghost') fail('BAD_TARGET');
  p.connected = connected;
  p.disconnectedAt = connected ? null : ctx.now;
}

function transferHost(ctx: Ctx, by: SeatId, to: SeatId): void {
  requireHost(ctx, by);
  const target = requirePlayer(ctx, to);
  if (target.kind !== 'human' || to === by) fail('BAD_TARGET');
  setHost(ctx, to);
}

function removePlayer(ctx: Ctx, seat: SeatId, kicked: boolean): void {
  const { d } = ctx;
  const p = requirePlayer(ctx, seat);
  if (p.kind === 'ghost') fail('BAD_TARGET');
  const inRound = ROUND_PHASES.includes(d.phase);

  if (inRound && d.round?.judge === seat) voidRound(ctx, 'judgeLeft');

  const round = d.round;
  if (round) {
    round.participants = round.participants.filter((id) => id !== seat);
    delete round.votes[seat];
    const sub = submissionOf(round, seat);
    // Nel risultato le risposte restano visibili; si scartano al round successivo.
    if (sub && d.phase !== 'result') {
      round.submissions = round.submissions.filter((s) => s !== sub);
      d.piles.whiteDiscard.push(...sub.cards);
      const pos = round.order.indexOf(sub.id);
      if (pos >= 0) {
        round.order.splice(pos, 1);
        if (pos < round.revealed) round.revealed -= 1;
      }
      for (const [voter, target] of Object.entries(round.votes)) {
        if (target === sub.id) delete round.votes[voter];
      }
    }
  }

  d.piles.whiteDiscard.push(...p.hand);
  d.players = d.players.filter((x) => x.id !== seat);
  ctx.events.push({ type: 'playerLeft', seat, kicked });

  if (d.hostId === seat) {
    const rest = humans(d);
    setHost(ctx, (rest.find((x) => x.connected) ?? rest[0])?.id ?? null);
  }

  if (!ROUND_PHASES.includes(d.phase) || !d.round) return;
  const r = d.round;
  if (activeHumans(d).length < MIN_PLAYERS) return voidRound(ctx, 'notEnoughPlayers');
  if (d.phase === 'choosing') return checkChoosingComplete(ctx);
  if (d.phase === 'revealing' || d.phase === 'judging') {
    if (r.submissions.length < 2) return voidRound(ctx, 'fewAnswers');
    if (d.phase === 'revealing' && r.revealed >= r.order.length) return beginJudging(ctx);
    if (d.phase === 'judging' && d.config.voting) return checkVotingComplete(ctx);
  }
}

/* ----------------------------------------------------------------- lobby */

function loadCards(ctx: Ctx, by: SeatId, black: BlackCard[], white: WhiteCard[]): void {
  requireHost(ctx, by);
  requirePhase(ctx, 'lobby');
  if (!Array.isArray(black) || !Array.isArray(white)) fail('BAD_CARDS');
  if (black.length > MAX_CARDS || white.length > MAX_CARDS) fail('BAD_CARDS');
  const blackMap: Record<CardId, BlackCard> = {};
  for (const c of black) {
    const text = cleanText(c?.text, 300);
    if (typeof c?.id !== 'string' || !c.id || blackMap[c.id] || !text) fail('BAD_CARDS');
    if (c.pick !== 1 && c.pick !== 2 && c.pick !== 3) fail('BAD_CARDS');
    blackMap[c.id] = { id: c.id, text, pick: c.pick };
  }
  const whiteMap: Record<CardId, WhiteCard> = {};
  for (const c of white) {
    const text = cleanText(c?.text, 300);
    if (typeof c?.id !== 'string' || !c.id || whiteMap[c.id] || !text || c.blank) fail('BAD_CARDS');
    whiteMap[c.id] = { id: c.id, text };
  }
  ctx.d.cards = { black: blackMap, white: whiteMap };
}

function start(ctx: Ctx, by: SeatId): void {
  const { d } = ctx;
  requireHost(ctx, by);
  requirePhase(ctx, 'lobby');
  if (activeHumans(d).length < MIN_PLAYERS) fail('NOT_ENOUGH_PLAYERS');

  d.players = d.players.filter((p) => p.kind !== 'ghost');
  if (d.config.ghost) {
    d.seq += 1;
    d.players.push({
      id: GHOST_ID,
      name: GHOST_NAME,
      kind: 'ghost',
      status: 'active',
      connected: true,
      disconnectedAt: null,
      order: d.seq,
      score: 0,
      hand: [],
    });
  }

  for (const id of Object.keys(d.cards.white)) {
    if (d.cards.white[id]?.blank) delete d.cards.white[id];
  }
  for (let i = 1; i <= d.config.blankCards; i++) {
    const id = `blank-${i}`;
    d.cards.white[id] = { id, text: '', blank: true };
  }

  const whiteIds = Object.keys(d.cards.white);
  const blackIds = Object.keys(d.cards.black);
  if (
    blackIds.length === 0 ||
    whiteIds.length < minWhiteCards(d.players.length, d.config.handSize)
  ) {
    fail('NOT_ENOUGH_CARDS');
  }

  d.piles = {
    blackDraw: shuffle(d, blackIds),
    blackDiscard: [],
    whiteDraw: shuffle(d, whiteIds),
    whiteDiscard: [],
  };
  for (const p of d.players) {
    p.status = 'active';
    p.score = 0;
    p.hand = [];
  }
  d.round = null;
  d.roundsPlayed = 0;
  d.roundCounter = 0;
  d.lastJudgeOrder = null;
  d.winners = [];
  d.endReason = null;
  ctx.events.push({ type: 'gameStarted' });
  startRound(ctx);
}

function rematch(ctx: Ctx, by: SeatId): void {
  const { d } = ctx;
  requireHost(ctx, by);
  requirePhase(ctx, 'ended');
  d.players = d.players.filter((p) => p.kind !== 'ghost');
  for (const p of d.players) {
    p.status = 'active';
    p.score = 0;
    p.hand = [];
  }
  d.piles = { blackDraw: [], blackDiscard: [], whiteDraw: [], whiteDiscard: [] };
  d.round = null;
  d.phase = 'lobby';
  d.deadline = null;
  d.winners = [];
  d.endReason = null;
  ctx.events.push({ type: 'backToLobby' });
}

/* ----------------------------------------------------------------- round */

function pickJudge(ctx: Ctx): Player | null {
  const { d } = ctx;
  const candidates = activeHumans(d);
  if (candidates.length === 0) return null;
  let startAt: number;
  if (d.lastJudgeOrder === null) {
    startAt = Math.floor(rand(d) * candidates.length);
  } else {
    const last = d.lastJudgeOrder;
    startAt = Math.max(
      0,
      candidates.findIndex((p) => p.order > last),
    );
  }
  for (let k = 0; k < candidates.length; k++) {
    const p = candidates[(startAt + k) % candidates.length] as Player;
    if (p.connected) return p;
  }
  return candidates[startAt] as Player;
}

function startRound(ctx: Ctx): void {
  const { d } = ctx;
  d.round = null;
  d.deadline = null;
  for (const p of d.players) if (p.status === 'waiting') p.status = 'active';

  if (activeHumans(d).length < MIN_PLAYERS) {
    d.phase = 'paused';
    ctx.events.push({ type: 'paused' });
    return;
  }

  const judge = d.config.voting ? null : pickJudge(ctx);
  const blackId = drawBlack(ctx);
  if (!blackId) return endGame(ctx, 'deck');
  const black = d.cards.black[blackId] as BlackCard;

  for (const p of [...d.players].sort(byOrder)) {
    const missing = d.config.handSize - p.hand.length;
    if (missing > 0) p.hand.push(...drawWhite(ctx, missing));
  }

  const participants = d.players
    .filter((p) => p.status === 'active' && p.id !== judge?.id)
    .sort(byOrder);
  if (participants.some((p) => p.hand.length < black.pick)) {
    d.piles.blackDiscard.push(blackId);
    return endGame(ctx, 'deck');
  }

  if (judge) d.lastJudgeOrder = judge.order;
  d.roundCounter += 1;
  d.round = {
    number: d.roundCounter,
    judge: judge?.id ?? null,
    black: blackId,
    participants: participants.map((p) => p.id),
    submissions: [],
    order: [],
    revealed: 0,
    votes: {},
    winners: [],
    winningSubmissions: [],
    outcome: null,
    voidReason: null,
  };
  ctx.events.push({ type: 'roundStarted', round: d.roundCounter, judge: judge?.id ?? null });

  if (d.config.dealMs > 0) {
    d.phase = 'dealing';
    setDeadline(ctx, d.config.dealMs);
  } else {
    beginChoosing(ctx);
  }
}

function beginChoosing(ctx: Ctx): void {
  const { d } = ctx;
  const round = requireRound(ctx);
  d.phase = 'choosing';
  setDeadline(ctx, d.config.choosingSeconds === null ? null : d.config.choosingSeconds * 1000);
  ctx.events.push({ type: 'choosingStarted' });
  const ghost = d.players.find((p) => p.kind === 'ghost' && round.participants.includes(p.id));
  if (ghost) ghostPlay(ctx, ghost, round);
  checkChoosingComplete(ctx);
}

function ghostPlay(ctx: Ctx, ghost: Player, round: Round): void {
  const { d } = ctx;
  const n = blackOf(ctx, round).pick;
  const isBlank = (id: CardId) => d.cards.white[id]?.blank === true;
  const preferred = [
    ...shuffle(
      d,
      ghost.hand.filter((id) => !isBlank(id)),
    ),
    ...ghost.hand.filter(isBlank),
  ];
  const cards = preferred.slice(0, n);
  const texts = cards.map((id) =>
    isBlank(id) ? 'il silenzio imbarazzato del Fantasma' : (d.cards.white[id] as WhiteCard).text,
  );
  submit(ctx, ghost, round, cards, texts);
}

function submit(ctx: Ctx, p: Player, round: Round, cards: CardId[], texts: string[]): void {
  p.hand = p.hand.filter((id) => !cards.includes(id));
  round.submissions.push({ id: newSubmissionId(ctx.d), by: p.id, cards, texts });
  ctx.events.push({ type: 'played', seat: p.id });
}

function play(
  ctx: Ctx,
  by: SeatId,
  cards: CardId[],
  blankTexts: Record<CardId, string> | undefined,
): void {
  const { d } = ctx;
  requirePhase(ctx, 'choosing');
  const round = requireRound(ctx);
  if (!round.participants.includes(by)) fail('NOT_PARTICIPANT');
  const p = requirePlayer(ctx, by);
  if (submissionOf(round, by)) fail('ALREADY_PLAYED');
  const need = blackOf(ctx, round).pick;
  if (
    !Array.isArray(cards) ||
    cards.length !== need ||
    new Set(cards).size !== cards.length ||
    cards.some((id) => !p.hand.includes(id))
  ) {
    fail('BAD_CARDS');
  }
  const texts = cards.map((id) => {
    const card = d.cards.white[id] as WhiteCard;
    if (!card.blank) return card.text;
    return cleanText(blankTexts?.[id], MAX_BLANK_TEXT_LENGTH) ?? fail('BAD_TEXT');
  });
  submit(ctx, p, round, [...cards], texts);
  checkChoosingComplete(ctx);
}

function retract(ctx: Ctx, by: SeatId): void {
  requirePhase(ctx, 'choosing');
  const round = requireRound(ctx);
  const sub = submissionOf(round, by) ?? fail('NOT_PLAYED');
  const p = requirePlayer(ctx, by);
  round.submissions = round.submissions.filter((s) => s !== sub);
  p.hand.push(...sub.cards);
  ctx.events.push({ type: 'retracted', seat: by });
}

function swapHand(ctx: Ctx, by: SeatId): void {
  const { d } = ctx;
  if (!d.config.handSwap) fail('RULE_DISABLED');
  requirePhase(ctx, 'choosing');
  const round = requireRound(ctx);
  const p = requirePlayer(ctx, by);
  if (p.kind !== 'human' || p.status !== 'active') fail('NOT_PARTICIPANT');
  if (submissionOf(round, by)) fail('ALREADY_PLAYED');
  if (p.score < 1) fail('NO_POINTS');
  const old = p.hand;
  p.hand = [];
  d.piles.whiteDiscard.push(...old);
  p.hand = drawWhite(ctx, d.config.handSize);
  p.score -= 1;
  ctx.events.push({ type: 'handSwapped', seat: by });
}

function checkChoosingComplete(ctx: Ctx): void {
  const { d } = ctx;
  const round = d.round;
  if (d.phase !== 'choosing' || !round) return;
  const done = round.participants.every((id) => {
    const p = findPlayer(d, id);
    return !p || submissionOf(round, id) !== undefined || !isPresent(ctx, p);
  });
  if (done) closeChoosing(ctx);
}

function closeChoosing(ctx: Ctx): void {
  const round = requireRound(ctx);
  if (round.submissions.length < 2) return voidRound(ctx, 'fewAnswers');
  ctx.d.phase = 'revealing';
  ctx.d.deadline = null;
  round.order = shuffle(
    ctx.d,
    round.submissions.map((s) => s.id),
  );
  round.revealed = 0;
  ctx.events.push({ type: 'revealStarted' });
}

function reveal(ctx: Ctx, by: SeatId, index: number): void {
  const { d } = ctx;
  requirePhase(ctx, 'revealing');
  const round = requireRound(ctx);
  const p = requirePlayer(ctx, by);
  const allowed = d.config.voting
    ? p.kind === 'human' && p.status === 'active'
    : round.judge === by;
  if (!allowed) fail('NOT_ALLOWED');
  if (!Number.isInteger(index) || index < 0 || index > round.revealed) fail('BAD_INDEX');
  if (index < round.revealed) return; // già svelata: un doppio tap non fa danni
  round.revealed += 1;
  ctx.events.push({ type: 'revealed', index });
  if (round.revealed >= round.order.length) beginJudging(ctx);
}

function beginJudging(ctx: Ctx): void {
  const { d } = ctx;
  d.phase = 'judging';
  setDeadline(ctx, d.config.judgingSeconds === null ? null : d.config.judgingSeconds * 1000);
  ctx.events.push({ type: 'judgingStarted' });
}

function pick(ctx: Ctx, by: SeatId, submissionId: SubmissionId): void {
  const { d } = ctx;
  requirePhase(ctx, 'judging');
  const round = requireRound(ctx);
  if (d.config.voting || round.judge !== by) fail('NOT_ALLOWED');
  const sub = round.submissions.find((s) => s.id === submissionId) ?? fail('UNKNOWN_SUBMISSION');
  award(ctx, round, [sub]);
}

function vote(ctx: Ctx, by: SeatId, submissionId: SubmissionId): void {
  const { d } = ctx;
  requirePhase(ctx, 'judging');
  const round = requireRound(ctx);
  const p = requirePlayer(ctx, by);
  if (!d.config.voting || p.kind !== 'human' || p.status !== 'active') fail('NOT_ALLOWED');
  const sub = round.submissions.find((s) => s.id === submissionId) ?? fail('UNKNOWN_SUBMISSION');
  if (sub.by === by) fail('OWN_SUBMISSION');
  round.votes[by] = sub.id;
  ctx.events.push({ type: 'voted', seat: by });
  checkVotingComplete(ctx);
}

function checkVotingComplete(ctx: Ctx): void {
  const { d } = ctx;
  const round = d.round;
  if (d.phase !== 'judging' || !round || !d.config.voting) return;
  const voters = activeHumans(d).filter((p) => isPresent(ctx, p));
  if (voters.length > 0 && voters.every((v) => round.votes[v.id] !== undefined)) tally(ctx, round);
}

function tally(ctx: Ctx, round: Round): void {
  const counts = new Map<SubmissionId, number>();
  for (const sid of Object.values(round.votes)) counts.set(sid, (counts.get(sid) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  if (max === 0) return noWinner(ctx, round);
  award(
    ctx,
    round,
    round.submissions.filter((s) => counts.get(s.id) === max),
  );
}

function award(ctx: Ctx, round: Round, subs: Submission[]): void {
  const { d } = ctx;
  const winners = [...new Set(subs.map((s) => s.by))];
  for (const id of winners) {
    const p = findPlayer(d, id);
    if (p) p.score += 1;
  }
  round.winners = winners;
  round.winningSubmissions = subs.map((s) => s.id);
  round.outcome = 'won';
  d.roundsPlayed += 1;
  d.phase = 'result';
  setDeadline(ctx, d.config.resultMs);
  ctx.events.push({ type: 'roundWon', winners, submissions: round.winningSubmissions });
}

function noWinner(ctx: Ctx, round: Round): void {
  round.outcome = 'noWinner';
  ctx.d.roundsPlayed += 1;
  ctx.d.phase = 'result';
  setDeadline(ctx, ctx.d.config.resultMs);
  ctx.events.push({ type: 'roundNoWinner' });
}

/** Annulla il round: le carte giocate tornano a chi le ha giocate. */
function voidRound(ctx: Ctx, reason: VoidReason): void {
  const { d } = ctx;
  const round = requireRound(ctx);
  for (const s of round.submissions) {
    const p = findPlayer(d, s.by);
    if (p) p.hand.push(...s.cards);
    else d.piles.whiteDiscard.push(...s.cards);
  }
  round.submissions = [];
  round.order = [];
  round.revealed = 0;
  round.votes = {};
  round.outcome = 'voided';
  round.voidReason = reason;
  d.phase = 'result';
  setDeadline(ctx, d.config.resultMs);
  ctx.events.push({ type: 'roundVoided', reason });
}

function nextRound(ctx: Ctx, by: SeatId): void {
  requirePhase(ctx, 'result');
  const round = requireRound(ctx);
  if (ctx.d.hostId !== by && round.judge !== by) fail('NOT_ALLOWED');
  advanceFromResult(ctx);
}

function advanceFromResult(ctx: Ctx): void {
  const { d } = ctx;
  const round = d.round;
  if (round) {
    for (const s of round.submissions) d.piles.whiteDiscard.push(...s.cards);
    d.piles.blackDiscard.push(round.black);
    d.round = null;
  }
  const top = Math.max(0, ...d.players.map((p) => p.score));
  if (top >= d.config.targetScore) return endGame(ctx, 'target');
  if (d.config.maxRounds !== null && d.roundsPlayed >= d.config.maxRounds) {
    return endGame(ctx, 'rounds');
  }
  startRound(ctx);
}

function endGame(ctx: Ctx, reason: EndReason): void {
  const { d } = ctx;
  d.phase = 'ended';
  d.deadline = null;
  const top = Math.max(0, ...d.players.map((p) => p.score));
  d.winners = top > 0 ? d.players.filter((p) => p.score === top).map((p) => p.id) : [];
  d.endReason = reason;
  ctx.events.push({ type: 'gameEnded', winners: d.winners, reason });
}

/* ------------------------------------------------------------------ tempo */

function graceExpired(ctx: Ctx, p: Player | undefined, grace: number): boolean {
  return !!p && !p.connected && p.disconnectedAt !== null && ctx.now - p.disconnectedAt >= grace;
}

function tick(ctx: Ctx): void {
  const { d } = ctx;
  const host = findPlayer(d, d.hostId);
  if (graceExpired(ctx, host, d.config.hostGraceMs)) {
    const next = humans(d).find((p) => p.connected && p.id !== host?.id);
    if (next) setHost(ctx, next.id);
  }

  const round = d.round;
  if (round?.judge && ROUND_PHASES.includes(d.phase)) {
    if (graceExpired(ctx, findPlayer(d, round.judge), d.config.judgeGraceMs)) {
      return voidRound(ctx, 'judgeLeft');
    }
  }

  if (d.deadline !== null && ctx.now >= d.deadline) {
    switch (d.phase) {
      case 'dealing':
        return beginChoosing(ctx);
      case 'choosing':
        return closeChoosing(ctx);
      case 'judging':
        return d.config.voting ? tally(ctx, requireRound(ctx)) : noWinner(ctx, requireRound(ctx));
      case 'result':
        return advanceFromResult(ctx);
      default:
        d.deadline = null;
        return;
    }
  }

  if (d.phase === 'choosing') checkChoosingComplete(ctx);
  if (d.phase === 'judging') checkVotingComplete(ctx);
}

/**
 * Il prossimo istante, dopo `now`, in cui un `tick` può cambiare qualcosa (scadenze di fase e
 * tolleranze). Il server lo usa per programmare il proprio timer dopo ogni input.
 */
export function nextWakeAt(state: GameState, now: number): number | null {
  const times: number[] = [];
  if (state.deadline !== null) times.push(state.deadline);
  const { config, round } = state;
  const awayUntil = (p: Player | undefined, grace: number) => {
    if (p && !p.connected && p.disconnectedAt !== null) times.push(p.disconnectedAt + grace);
  };
  awayUntil(findPlayer(state, state.hostId), config.hostGraceMs);
  if (round && ROUND_PHASES.includes(state.phase)) {
    awayUntil(findPlayer(state, round.judge), config.judgeGraceMs);
    if (state.phase === 'choosing') {
      for (const id of round.participants) {
        if (!submissionOf(round, id)) awayUntil(findPlayer(state, id), config.playerGraceMs);
      }
    }
    if (state.phase === 'judging' && config.voting) {
      for (const p of activeHumans(state)) {
        if (round.votes[p.id] === undefined) awayUntil(p, config.playerGraceMs);
      }
    }
  }
  const future = times.filter((t) => t > now);
  return future.length ? Math.min(...future) : null;
}
