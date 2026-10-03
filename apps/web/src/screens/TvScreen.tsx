import { composeSentence } from '@cirelli/decks/text';
import { BlackCard } from '../components/BlackCard.tsx';
import { Qr } from '../components/Qr.tsx';
import { errorText } from '../lib/copy.ts';
import { useCountdown, useRoom } from '../lib/use-room.ts';

/** Vista per TV o portatile: carta nera, rivelazioni e classifica. I telefoni fanno da controller. */
export function TvScreen({ code }: { code: string }) {
  const { snapshot } = useRoom(code, 'screen', null);
  const view = snapshot.view;
  const seconds = useCountdown(view?.deadline ?? null, snapshot.clockOffset);
  if (snapshot.fatal)
    return (
      <main className="page center tv">
        <p className="lead">{errorText(snapshot.fatal)}</p>
      </main>
    );
  if (!view)
    return (
      <main className="page center tv">
        <p className="lead">Collegamento alla stanza {code}…</p>
      </main>
    );

  const url = `${location.origin}/r/${code}`;
  const round = view.round;
  const judge = view.players.find((p) => p.isJudge);
  const latest = round?.submissions[round.submissions.length - 1];
  const sorted = [...view.players].sort((a, b) => b.score - a.score);

  return (
    <main className="tv">
      <section className="tv-main">
        {view.phase === 'lobby' || view.phase === 'paused' || !round ? (
          <div className="tv-join">
            <Qr text={url} label={`QR per entrare nella stanza ${code}`} />
            <div>
              <p className="room-code">{code}</p>
              <p className="lead">{url.replace(/^https?:\/\//, '')}</p>
              {view.phase === 'ended' && <p className="lead">Partita finita.</p>}
            </div>
          </div>
        ) : (
          <>
            <BlackCard
              text={round.black.text}
              answers={
                view.phase === 'revealing'
                  ? latest?.texts
                  : round.submissions.find((s) => s.winner)?.texts
              }
            />
            <p className="lead">
              {view.phase === 'choosing' &&
                `${round.played} di ${round.participants} hanno giocato.`}
              {view.phase === 'revealing' && `Risposta ${round.revealed} di ${round.total}.`}
              {view.phase === 'judging' && (judge ? `${judge.name} sceglie.` : 'Si vota.')}
              {view.phase === 'result' &&
                round.outcome === 'won' &&
                `Punto a ${round.winners.map((id) => view.players.find((p) => p.id === id)?.name).join(' e ')}.`}
              {seconds !== null && ` ${seconds} secondi.`}
            </p>
            {view.phase === 'judging' && (
              <ol className="answers">
                {round.submissions.map((s) => (
                  <li key={s.id} className="answer">
                    <p>{composeSentence(round.black.text, s.texts)}</p>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </section>
      <aside className="tv-side">
        <h2>Classifica</h2>
        <ol className="scores">
          {sorted.map((p) => (
            <li key={p.id}>
              <span>
                {p.name}
                {p.isJudge ? ' (giudice)' : ''}
              </span>
              <span>{p.score}</span>
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}
