import type { PickCount } from '@cirelli/engine';

export const BLANK = '___';
const BLANK_RUN = /_{3,}/g;

/** Testo pulito: spazi compressi, ogni sequenza di tre o più trattini bassi diventa "___". */
export function normalizeCardText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim().replace(BLANK_RUN, BLANK);
}

export function countBlanks(text: string): number {
  return normalizeCardText(text).split(BLANK).length - 1;
}

/** Carte da giocare: gli spazi, da 1 a 3. Senza spazi si gioca una carta in coda. */
export function pickFor(text: string): PickCount {
  return Math.min(3, Math.max(1, countBlanks(text))) as PickCount;
}

export type Segment = { kind: 'text'; value: string } | { kind: 'blank'; index: number };

/**
 * Divide il testo di una carta nera in pezzi di testo e spazi numerati.
 * Senza spazi aggiunge uno spazio in coda, dove andrà la risposta.
 */
export function segmentsOf(text: string): Segment[] {
  const parts = normalizeCardText(text).split(BLANK);
  const out: Segment[] = [];
  parts.forEach((value, i) => {
    if (value) out.push({ kind: 'text', value });
    if (i < parts.length - 1) out.push({ kind: 'blank', index: i });
  });
  if (parts.length === 1) out.push({ kind: 'blank', index: 0 });
  return out;
}

const SENTENCE_START = /(^|[.!?…]\s*)$/;

/** Adatta una risposta al punto in cui va inserita: maiuscola a inizio frase, niente punto finale in mezzo. */
export function fitAnswer(answer: string, before: string, after: string): string {
  let a = normalizeCardText(answer);
  if (after.trim() !== '' && !/^[.!?…]/.test(after.trim())) a = a.replace(/[.]$/, '');
  else if (after.trim() !== '') a = a.replace(/[.!?]$/, '');
  if (SENTENCE_START.test(before)) a = a.charAt(0).toLocaleUpperCase('it') + a.slice(1);
  return a;
}

/** Frase completa, utile per la lettura ad alta voce e per gli screen reader. */
export function composeSentence(black: string, answers: string[]): string {
  const segments = segmentsOf(black);
  const zeroBlanks = countBlanks(black) === 0;
  let out = '';
  segments.forEach((seg, i) => {
    if (seg.kind === 'text') {
      out += seg.value;
      return;
    }
    const answer = answers[seg.index] ?? BLANK;
    const next = segments[i + 1];
    const after = next?.kind === 'text' ? next.value : '';
    const fitted = answer === BLANK ? BLANK : fitAnswer(answer, out, after);
    out += zeroBlanks ? ` ${fitted}` : fitted;
  });
  return out.replace(/\s+/g, ' ').trim();
}
