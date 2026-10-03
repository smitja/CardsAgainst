import type { GameView, PublicSubmission, WhiteCard } from '@cirelli/engine';
import { deckWarnings } from '@cirelli/decks/combine';
import { composeSentence } from '@cirelli/decks/text';
import { useEffect, useState, type FormEvent } from 'react';
import { BlackCard } from '../components/BlackCard.tsx';
import { Players } from '../components/Players.tsx';
import { Qr } from '../components/Qr.tsx';
import { VOID_REASON, errorText } from '../lib/copy.ts';
import { takePendingName } from '../lib/pending.ts';
import { navigate } from '../lib/router.ts';
import { useCountdown, useRoom } from '../lib/use-room.ts';
import { hasToken, savedName, type RoomClient, type RoomSnapshot } from '../net/room-client.ts';

export function RoomScreen({ code }: { code: string }) {
  const [name, setName] = useState<string | null>(() =>
    hasToken(code) ? '' : takePendingName(code),
  );
  const { client, snapshot } = useRoom(code, 'player', name);

  if (snapshot.fatal === 'BAD_TOKEN' || snapshot.fatal === 'NAME_REQUIRED') {
    if (name !== null) setName(null);
  }
  if (name === null) return <JoinForm code={code} onJoin={setName} />;
  if (snapshot.fatal) return <Fatal code={snapshot.fatal} />;
  if (!client || !snapshot.view) return <Connecting status={snapshot.status} />;
  return <Table client={client} snap={snapshot} view={snapshot.view} />;
}

function JoinForm({ code, onJoin }: { code: string; onJoin: (name: string) => void }) {
  const [value, setValue] = useState(savedName);
  const [room, setRoom] = useState<'checking' | 'ok' | 'missing' | 'full'>('checking');
  useEffect(() => {
    fetch(`/api/rooms/${code}`)
      .then(async (r) => {
        if (!r.ok) return setRoom('missing');
        const info = (await r.json()) as { full: boolean };
        setRoom(info.full ? 'full' : 'ok');
      })
      .catch(() => setRoom('ok'));
  }, [code]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (value.trim()) onJoin(value.trim());
  }

  if (room === 'missing') return <Fatal code="ROOM_NOT_FOUND" />;
  return (
    <main className="page join">
      <p className="room-code" aria-label={`Stanza ${code.split('').join(' ')}`}>
        {code}
      </p>
      <form onSubmit={submit} className="stack thumb">
        {room === 'full' && <p className="error">{errorText('ROOM_FULL')}</p>}
        <label htmlFor="nick">Il tuo nickname</label>
        <input
          id="nick"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={20}
          autoFocus
          autoComplete="nickname"
          enterKeyHint="go"
        />
        <button className="primary" disabled={!value.trim() || room === 'full'}>
          Entra nella stanza
        </button>
      </form>
    </main>
  );
}

function Fatal({ code }: { code: string }) {
  return (
    <main className="page center">
      <p className="lead">{errorText(code)}</p>
      <button className="primary" onClick={() => navigate('/')}>
        Torna all’inizio
      </button>
    </main>
  );
}

function Connecting({ status }: { status: string }) {
  return (
    <main className="page center" aria-busy="true">
      <p className="lead">
        {status === 'reconnecting' ? 'Rete persa, mi riconnetto…' : 'Entro nella stanza…'}
      </p>
    </main>
  );
}

/* ------------------------------------------------------------------ tavolo */

interface TableProps {
  client: RoomClient;
  snap: RoomSnapshot;
  view: GameView;
}

function Table({ client, snap, view }: TableProps) {
  const [invite, setInvite] = useState(false);
  const me = snap.seat;
  const isHost = view.hostId === me;
  const seconds = useCountdown(view.deadline, snap.clockOffset);
  const showTimer = seconds !== null && (view.phase === 'choosing' || view.phase === 'judging');

  return (
    <div className="table">
      <header className="topbar">
        <button
          className="code-button"
          onClick={() => setInvite(true)}
          aria-label={`Invita: codice ${client.code}`}
        >
          {client.code}
        </button>
        {snap.status !== 'open' && (
          <span className="net" role="status">
            {snap.status === 'reconnecting' ? 'Riconnessione…' : 'Connessione…'}
          </span>
        )}
        {showTimer && (
          <span className="timer" role="timer" aria-label={`${seconds} secondi`}>
            {seconds}s
          </span>
        )}
        <button className="ghost-button" onClick={() => client.leave()}>
          Esci
        </button>
      </header>

      <Players view={view} me={me} />

      <main className="phase">
        <Phase
          client={client}
          view={view}
          me={me}
          isHost={isHost}
          room={snap.room}
          onInvite={() => setInvite(true)}
        />
      </main>

      {snap.notice && <Notice key={snap.notice.at} code={snap.notice.code} />}

      {invite && <Invite code={client.code} onClose={() => setInvite(false)} />}
    </div>
  );
}

function Notice({ code }: { code: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <p className="notice" role="alert">
      {errorText(code)}
    </p>
  );
}

function Invite({ code, onClose }: { code: string; onClose: () => void }) {
  const url = `${location.origin}/r/${code}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Invita nella stanza">
      <Qr text={url} label={`QR per entrare nella stanza ${code}`} />
      <p className="room-code">{code}</p>
      <p className="url">{url.replace(/^https?:\/\//, '')}</p>
      <div className="stack thumb">
        {'share' in navigator && (
          <button
            className="secondary"
            onClick={() => navigator.share({ title: 'Cards Against Cirelli', url }).catch(() => {})}
          >
            Condividi il link
          </button>
        )}
        <button
          className="secondary"
          onClick={() =>
            navigator.clipboard
              ?.writeText(url)
              .then(() => setCopied(true))
              .catch(() => {})
          }
        >
          {copied ? 'Link copiato' : 'Copia il link'}
        </button>
        <button className="primary" onClick={onClose} autoFocus>
          Chiudi
        </button>
      </div>
    </div>
  );
}

interface PhaseProps {
  client: RoomClient;
  view: GameView;
  me: string | null;
  isHost: boolean;
  room: RoomSnapshot['room'];
  onInvite: () => void;
}

function Phase(props: PhaseProps) {
  const { view } = props;
  switch (view.phase) {
    case 'lobby':
      return <Lobby {...props} />;
    case 'paused':
      return (
        <Waiting title="Aspettiamo qualcuno" text="Servono almeno tre giocatori per continuare.">
          <button className="primary" onClick={props.onInvite}>
            Invita
          </button>
        </Waiting>
      );
    case 'dealing':
      return <Waiting title={`Round ${view.round?.number}`} text="Si distribuiscono le carte…" />;
    case 'choosing':
      return <Choosing key={view.round?.number} {...props} />;
    case 'revealing':
    case 'judging':
      return <Reveal {...props} />;
    case 'result':
      return <Result {...props} />;
    case 'ended':
      return <Ended {...props} />;
  }
}

function Waiting({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="waiting">
      <h2>{title}</h2>
      <p className="lead">{text}</p>
      {children && <div className="stack thumb">{children}</div>}
    </section>
  );
}

/* ------------------------------------------------------------------- lobby */

function Lobby({ client, view, me, isHost, room, onInvite }: PhaseProps) {
  const humans = view.players.filter((p) => p.kind === 'human');
  const players = humans.length + (view.config.ghost ? 1 : 0);
  const check = deckWarnings(
    { black: view.deck.black, white: view.deck.white + view.config.blankCards },
    Math.max(3, players),
    view.config.handSize,
  );
  const url = `${location.origin}/r/${client.code}`;
  const set = (config: Partial<GameView['config']>) => client.send({ type: 'setConfig', config });

  return (
    <section className="lobby">
      <button className="qr-button" onClick={onInvite} aria-label="Mostra il QR a schermo intero">
        <Qr text={url} label={`QR per entrare nella stanza ${client.code}`} />
      </button>
      <p className="room-code">{client.code}</p>
      <p className="hint">Fai inquadrare il QR o detta il codice.</p>

      <h2>In stanza ({humans.length}/10)</h2>
      <ul className="list">
        {humans.map((p) => (
          <li key={p.id}>
            <span>
              {p.name}
              {p.id === me ? ' (tu)' : ''}
              {p.isHost ? ', host' : ''}
              {!p.connected ? ', disconnesso' : ''}
            </span>
            {isHost && p.id !== me && (
              <button className="small" onClick={() => client.send({ type: 'kick', target: p.id })}>
                Espelli
              </button>
            )}
          </li>
        ))}
      </ul>

      <h2>Mazzi</h2>
      <Decks client={client} room={room} isHost={isHost} />
      {check.warnings.includes('NOT_ENOUGH_WHITE') && (
        <p className="warn">
          Per {players} giocatori servono almeno {check.needed} carte bianche.
        </p>
      )}
      {check.warnings.includes('FEW_WHITE') && (
        <p className="warn">Le carte bianche basteranno, ma si ripeteranno presto.</p>
      )}

      {isHost ? (
        <>
          <h2>Regole</h2>
          <div className="rules">
            <label>
              Punti per vincere
              <select
                value={view.config.targetScore}
                onChange={(e) => set({ targetScore: Number(e.target.value) })}
              >
                {[3, 5, 7, 10, 15].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Limite di round
              <select
                value={view.config.maxRounds ?? 0}
                onChange={(e) => set({ maxRounds: Number(e.target.value) || null })}
              >
                <option value={0}>nessuno</option>
                {[5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tempo per scegliere
              <select
                value={view.config.choosingSeconds ?? 0}
                onChange={(e) => set({ choosingSeconds: Number(e.target.value) || null })}
              >
                <option value={0}>illimitato</option>
                {[45, 60, 90, 120].map((n) => (
                  <option key={n} value={n}>
                    {n} secondi
                  </option>
                ))}
              </select>
            </label>
            <Toggle
              label="Giocatore fantasma"
              on={view.config.ghost}
              onChange={(v) => set({ ghost: v })}
            />
            <Toggle
              label="Cambio mano per un punto"
              on={view.config.handSwap}
              onChange={(v) => set({ handSwap: v })}
            />
            <Toggle
              label="Voto di tutti al posto del giudice"
              on={view.config.voting}
              onChange={(v) => set({ voting: v })}
            />
            <Toggle
              label="Carte jolly da scrivere"
              on={view.config.blankCards > 0}
              onChange={(v) => set({ blankCards: v ? 10 : 0 })}
            />
          </div>
          <div className="stack thumb sticky-bottom">
            <button
              className="primary"
              disabled={humans.length < 3 || check.blocking}
              onClick={() => client.send({ type: 'start' })}
            >
              {humans.length < 3
                ? `Servono ancora ${3 - humans.length} giocatori`
                : 'Inizia la partita'}
            </button>
          </div>
        </>
      ) : (
        <p className="lead thumb">Aspettiamo che l’host inizi la partita.</p>
      )}
    </section>
  );
}

function Decks({
  client,
  room,
  isHost,
}: {
  client: RoomClient;
  room: RoomSnapshot['room'];
  isHost: boolean;
}) {
  const [code, setCode] = useState('');
  if (!room) return null;
  const active = room.decks.map((d) => d.code);
  const builtin = new Set(room.available.map((d) => d.code));
  const custom = room.decks.filter((d) => !builtin.has(d.code));
  const setDecks = (decks: string[]) => client.send({ type: 'setDecks', decks });
  const toggle = (id: string, on: boolean) =>
    setDecks(on ? [...active, id] : active.filter((c) => c !== id));
  const describe = (d: { black: number; white: number }) => `${d.black} nere, ${d.white} bianche`;

  if (!isHost) {
    return (
      <ul className="list">
        {room.decks.map((d) => (
          <li key={d.code}>
            {d.name}: {describe(d)}
          </li>
        ))}
      </ul>
    );
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(c) || active.includes(c)) return;
    setDecks([...active, c]);
    setCode('');
  }

  return (
    <div className="decks">
      {room.available.map((d) => {
        const on = active.includes(d.code);
        return (
          <label key={d.code} className="toggle">
            <input
              type="checkbox"
              role="switch"
              checked={on}
              // Almeno un mazzo resta sempre attivo.
              disabled={on && active.length === 1}
              onChange={(e) => toggle(d.code, e.target.checked)}
            />
            <span>
              {d.name}
              <small className="hint"> {describe(d)}</small>
            </span>
          </label>
        );
      })}
      {custom.map((d) => (
        <div key={d.code} className="custom-deck">
          <span>
            {d.name} ({d.code})<small className="hint"> {describe(d)}</small>
          </span>
          <button
            className="small"
            disabled={active.length === 1}
            onClick={() => toggle(d.code, false)}
          >
            Togli
          </button>
        </div>
      ))}
      <form onSubmit={add} className="add-deck">
        <label htmlFor="deck-code">Aggiungi un mazzo con il codice</label>
        <div className="row">
          <input
            id="deck-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            className="code-input"
          />
          <button className="secondary" disabled={!/^[A-Z0-9]{6}$/.test(code)}>
            Aggiungi
          </button>
        </div>
      </form>
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ scelta */

function Choosing({ client, view }: PhaseProps) {
  const round = view.round;
  const mine = view.me;
  const [selected, setSelected] = useState<string[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  if (!round || !mine) return null;
  const pick = round.black.pick;
  const me = view.players.find((p) => p.id === mine.id);
  const judge = view.players.find((p) => p.isJudge);

  if (round.judge === mine.id) {
    return (
      <section>
        <BlackCard text={round.black.text} />
        <Waiting
          title="Sei il giudice"
          text={`Aspetta le risposte: ${round.played} di ${round.participants} hanno giocato.`}
        />
      </section>
    );
  }
  if (!me?.inRound) {
    return (
      <section>
        <BlackCard text={round.black.text} />
        <Waiting title="Questo round lo guardi" text="Entri in gioco dal prossimo round." />
      </section>
    );
  }
  if (mine.submission) {
    return (
      <section>
        <BlackCard text={round.black.text} answers={mine.submission.texts} />
        <Waiting
          title="Fatto"
          text={`Aspettiamo gli altri: ${round.played} di ${round.participants}.${judge ? ` Giudica ${judge.name}.` : ''}`}
        >
          <button className="secondary" onClick={() => client.send({ type: 'retract' })}>
            Ripensaci
          </button>
        </Waiting>
      </section>
    );
  }

  const toggle = (card: WhiteCard) =>
    setSelected((s) =>
      s.includes(card.id) ? s.filter((x) => x !== card.id) : s.length < pick ? [...s, card.id] : s,
    );
  const answerText = (id: string) => {
    const card = mine.hand.find((c) => c.id === id);
    return card?.blank ? texts[id] || '…' : (card?.text ?? '');
  };
  const ready =
    selected.length === pick &&
    selected.every((id) => !mine.hand.find((c) => c.id === id)?.blank || texts[id]?.trim());
  const canSwap = view.config.handSwap && (me?.score ?? 0) > 0;

  return (
    <section className="choosing">
      <BlackCard text={round.black.text} answers={selected.map(answerText)} />
      {selected.length > 0 && (
        <p className="preview" aria-live="polite">
          {composeSentence(round.black.text, selected.map(answerText))}
        </p>
      )}
      <p className="hint">
        {pick === 1 ? 'Scegli una carta.' : `Scegli ${pick} carte, nell’ordine in cui vanno lette.`}
        {judge ? ` Giudica ${judge.name}.` : ''}
      </p>
      <ul className="hand" aria-label="La tua mano">
        {mine.hand.map((card) => {
          const order = selected.indexOf(card.id);
          return (
            <li key={card.id}>
              <button
                className={`white-card${order >= 0 ? ' selected' : ''}`}
                aria-pressed={order >= 0}
                onClick={() => toggle(card)}
              >
                {order >= 0 && pick > 1 && <span className="order">{order + 1}</span>}
                {card.blank ? <em>Carta jolly: la scrivi tu</em> : card.text}
              </button>
              {card.blank && order >= 0 && (
                <input
                  aria-label="Testo della carta jolly"
                  maxLength={80}
                  value={texts[card.id] ?? ''}
                  onChange={(e) => setTexts((t) => ({ ...t, [card.id]: e.target.value }))}
                  autoFocus
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="stack thumb sticky-bottom">
        <button
          className="primary"
          disabled={!ready}
          onClick={() => {
            const blankTexts = Object.fromEntries(
              selected.filter((id) => texts[id]).map((id) => [id, texts[id] as string]),
            );
            client.send({ type: 'play', cards: selected, blankTexts });
            setSelected([]);
          }}
        >
          {ready
            ? 'Gioca'
            : `Scegli ${pick - selected.length} ${pick - selected.length === 1 ? 'carta' : 'carte'}`}
        </button>
        {canSwap && (
          <button className="secondary" onClick={() => client.send({ type: 'swapHand' })}>
            Cambia mano (costa un punto)
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------- rivelazione e giudizio */

function Reveal({ client, view, me }: PhaseProps) {
  const round = view.round;
  if (!round) return null;
  const voting = view.config.voting;
  const isJudge = round.judge === me;
  const myPlayer = view.players.find((p) => p.id === me);
  const canReveal = voting ? myPlayer?.status === 'active' : isJudge;
  const judge = view.players.find((p) => p.isJudge);
  const judging = view.phase === 'judging';
  const latest = round.submissions[round.submissions.length - 1];

  return (
    <section className="reveal">
      <BlackCard text={round.black.text} answers={!judging ? latest?.texts : undefined} />
      <p className="hint" aria-live="polite">
        {judging
          ? voting
            ? 'Votate la migliore (non la vostra).'
            : isJudge
              ? 'Scegli la vincitrice.'
              : `${judge?.name ?? 'Il giudice'} sta scegliendo.`
          : `Risposta ${round.revealed} di ${round.total}.`}
      </p>
      <ol className="answers">
        {round.submissions.map((s) => (
          <Answer
            key={s.id}
            s={s}
            black={round.black.text}
            view={view}
            client={client}
            me={me}
            judging={judging}
            isJudge={isJudge}
          />
        ))}
      </ol>
      {!judging && (
        <div className="stack thumb sticky-bottom">
          {canReveal ? (
            <button
              className="primary"
              onClick={() => client.send({ type: 'reveal', index: round.revealed })}
            >
              {round.revealed === 0 ? 'Svela la prima risposta' : 'Svela la prossima'}
            </button>
          ) : (
            <p className="lead">{judge?.name ?? 'Il giudice'} sta svelando le risposte.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Answer(props: {
  s: PublicSubmission;
  black: string;
  view: GameView;
  client: RoomClient;
  me: string | null;
  judging: boolean;
  isJudge: boolean;
}) {
  const { s, black, view, client, judging, isJudge } = props;
  const voting = view.config.voting;
  const mine = view.me?.submission?.id === s.id;
  const voted = view.me?.vote === s.id;
  return (
    <li className={`answer${voted ? ' voted' : ''}`}>
      <p>{composeSentence(black, s.texts)}</p>
      {judging && !voting && isJudge && (
        <button className="primary" onClick={() => client.send({ type: 'pick', submission: s.id })}>
          Scegli questa
        </button>
      )}
      {judging && voting && !mine && (
        <button
          className={voted ? 'primary' : 'secondary'}
          onClick={() => client.send({ type: 'vote', submission: s.id })}
        >
          {voted ? 'Votata' : 'Vota questa'}
        </button>
      )}
      {judging && voting && mine && <span className="hint">La tua</span>}
    </li>
  );
}

/* ---------------------------------------------------------------- risultato */

function Result({ client, view, me, isHost }: PhaseProps) {
  const round = view.round;
  if (!round) return null;
  const name = (id: string) =>
    view.players.find((p) => p.id === id)?.name ?? 'qualcuno che è uscito';
  const canAdvance = isHost || round.judge === me;
  const winning = round.submissions.filter((s) => s.winner);

  return (
    <section className="result">
      {round.outcome === 'voided' && (
        <Waiting title="Round annullato" text={VOID_REASON[round.voidReason ?? ''] ?? ''} />
      )}
      {round.outcome === 'noWinner' && (
        <Waiting title="Nessun vincitore" text="Il tempo è finito senza una scelta." />
      )}
      {round.outcome === 'won' && (
        <>
          <h2>{round.winners.map(name).join(' e ')} prende il punto</h2>
          {winning.map((s) => (
            <BlackCard key={s.id} text={round.black.text} answers={s.texts} />
          ))}
          {round.winners.includes(me ?? '') && <p className="lead">Hai vinto il round.</p>}
        </>
      )}
      <Scores view={view} />
      <div className="stack thumb sticky-bottom">
        {canAdvance ? (
          <button className="primary" onClick={() => client.send({ type: 'nextRound' })}>
            Round successivo
          </button>
        ) : (
          <p className="hint">Il prossimo round parte tra poco.</p>
        )}
      </div>
    </section>
  );
}

function Scores({ view }: { view: GameView }) {
  const sorted = [...view.players].sort((a, b) => b.score - a.score);
  return (
    <ol className="scores" aria-label="Classifica">
      {sorted.map((p) => (
        <li key={p.id}>
          <span>{p.name}</span>
          <span>{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

function Ended({ client, view, isHost }: PhaseProps) {
  const names = view.winners.map((id) => view.players.find((p) => p.id === id)?.name ?? '?');
  return (
    <section className="ended">
      <h2>{names.length ? `Vince ${names.join(' e ')}` : 'Nessun vincitore'}</h2>
      <p className="lead">
        {view.endReason === 'rounds'
          ? 'Finiti i round a disposizione.'
          : view.endReason === 'deck'
            ? 'Le carte sono finite.'
            : `Arrivati a ${view.config.targetScore} punti.`}
      </p>
      <Scores view={view} />
      <div className="stack thumb sticky-bottom">
        {isHost ? (
          <button className="primary" onClick={() => client.send({ type: 'rematch' })}>
            Rivincita
          </button>
        ) : (
          <p className="hint">L’host può proporre la rivincita.</p>
        )}
      </div>
    </section>
  );
}
