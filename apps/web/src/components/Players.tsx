import type { GameView } from '@cirelli/engine';

/** Striscia dei giocatori: chi ha giocato, chi è il giudice, chi è disconnesso. */
export function Players({ view, me }: { view: GameView; me: string | null }) {
  const inRound = view.phase === 'choosing' || view.phase === 'dealing';
  return (
    <ul className="players" aria-label="Giocatori">
      {view.players.map((p) => {
        const state = p.isJudge
          ? 'giudice'
          : inRound && p.inRound
            ? p.played
              ? 'ha giocato'
              : 'sta scegliendo'
            : p.status === 'waiting'
              ? 'entra al prossimo round'
              : '';
        return (
          <li
            key={p.id}
            className={[
              'chip',
              p.id === me ? 'me' : '',
              p.isJudge ? 'judge' : '',
              inRound && p.played ? 'done' : '',
              !p.connected ? 'away' : '',
            ].join(' ')}
          >
            <span className="name">{p.id === me ? `${p.name} (tu)` : p.name}</span>
            <span className="score">{p.score}</span>
            <span className="state">
              {[state, p.isHost ? 'host' : '', !p.connected ? 'disconnesso' : '']
                .filter(Boolean)
                .join(', ')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
