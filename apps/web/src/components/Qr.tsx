import { renderSVG } from 'uqr';
import { useMemo } from 'react';

export function Qr({ text, label }: { text: string; label: string }) {
  const svg = useMemo(
    () => renderSVG(text, { border: 2, whiteColor: '#F6F6F3', blackColor: '#161616' }),
    [text],
  );
  return (
    <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
