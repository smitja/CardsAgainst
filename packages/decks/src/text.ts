import type { PickCount } from '@cirelli/engine';

export const BLANK = '___';
const BLANK_RUN = /_{3,}/g;

/** Testo pulito: spazi compressi, ogni sequenza di tre o più trattini bassi diventa "___". */
export function normalizeCardText(text: string): string {
  return (
    text
      .normalize('NFC')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(BLANK_RUN, BLANK)
      // Uno spazio attaccato a una parola ("___è") si stacca: "___ è".
      .replace(/___(?=[\p{L}\p{N}])/gu, '___ ')
      .replace(/(?<=[\p{L}\p{N}])___/gu, ' ___')
  );
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

/**
 * Parole iniziali che a metà frase vanno in minuscolo: articoli, preposizioni articolate,
 * determinanti e verbi all'infinito ("Brindare", "Farsi", "Essere"). I nomi propri restano.
 */
const LOWERABLE_START =
  /^(?:il|lo|la|i|gli|le|un|uno|una|l|un|dei|degli|delle|del|dello|della|al|allo|alla|ai|agli|alle|nel|nella|nei|nelle|qualunque|qualche|ogni|tutti|tutte|tutto|tutta|mio|mia|tuo|tua|suo|sua|questo|questa|quel|quella|[a-zà-ù]+(?:are|ere|ire|arsi|ersi|irsi|arla|arlo|arle|arli|erla|erlo|irla|irlo|arne|erne|irne|arci|erci|irci|argli|ergli|irgli))$/;

function lowerFirstIfCommon(text: string): string {
  const first = /^[\p{L}]+/u.exec(text)?.[0] ?? '';
  if (!first || first.length < 1) return text;
  const rest = first.slice(1);
  // Sigle e nomi tutti maiuscoli (KKK, CISL) restano come sono.
  if (rest && rest === rest.toLocaleUpperCase('it')) return text;
  const lower = first.toLocaleLowerCase('it');
  if (!LOWERABLE_START.test(lower)) return text;
  return lower + text.slice(first.length);
}

/** Adatta una risposta al punto in cui va inserita: maiuscola a inizio frase, minuscola in mezzo, niente punto finale in mezzo. */
export function fitAnswer(answer: string, before: string, after: string): string {
  let a = normalizeCardText(answer);
  if (after.trim() !== '' && !/^[.!?…]/.test(after.trim())) a = a.replace(/[.]$/, '');
  else if (after.trim() !== '') a = a.replace(/[.!?]$/, '');
  if (SENTENCE_START.test(before)) a = a.charAt(0).toLocaleUpperCase('it') + a.slice(1);
  else a = lowerFirstIfCommon(a);
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

export type FilledSegment =
  | { kind: 'text'; value: string }
  | { kind: 'answer'; index: number; value: string }
  | { kind: 'blank'; index: number };

/** Pezzi della carta nera con le risposte già adattate al punto in cui vanno (per disegnarle). */
export function fillSegments(black: string, answers: (string | undefined)[]): FilledSegment[] {
  const segments = segmentsOf(black);
  let before = '';
  return segments.map((seg, i) => {
    if (seg.kind === 'text') {
      before += seg.value;
      return seg;
    }
    const answer = answers[seg.index];
    if (!answer) return seg;
    const next = segments[i + 1];
    const value = fitAnswer(answer, before, next?.kind === 'text' ? next.value : '');
    before += value;
    return { kind: 'answer', index: seg.index, value };
  });
}
