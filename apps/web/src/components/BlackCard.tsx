import { fillSegments } from '@cirelli/decks/text';

/** Carta nera con gli spazi riempiti dalle risposte (se ci sono). */
export function BlackCard({
  text,
  answers = [],
  small = false,
}: {
  text: string;
  answers?: string[];
  small?: boolean;
}) {
  return (
    <div className={`black-card${small ? ' small' : ''}`}>
      <p>
        {fillSegments(text, answers).map((seg, i) =>
          seg.kind === 'text' ? (
            <span key={i}>{seg.value}</span>
          ) : seg.kind === 'answer' ? (
            <mark key={i}>{seg.value}</mark>
          ) : (
            <span key={i} className="blank" aria-label="spazio vuoto" />
          ),
        )}
      </p>
    </div>
  );
}
