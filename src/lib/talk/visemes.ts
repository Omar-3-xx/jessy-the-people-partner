/*
 * Lip sync from the words alone. A browser's voice says when each word starts
 * (and some voices not even that), never what the mouth is doing, so Tigo's
 * mouth follows the letters of what he is saying: open for "a", round for
 * "o" and "و", closed for "m", "b" and "م", and so on, timed at a child's
 * speaking pace. Written Arabic leaves most vowels out, so each Arabic
 * consonant is followed by the short vowel a speaker adds.
 *
 * When the voice reports a word boundary, the speaker realigns this timeline to
 * that letter (timeAtChar), so the mouth never drifts far from the sound.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

export interface MouthShape {
  /** 0 closed … 1 wide open. */
  open: number;
  /** Width of the mouth: 1 as drawn, below 1 rounded ("o"), above 1 stretched ("ee"). */
  wide: number;
}

export interface MouthKey extends MouthShape {
  /** Milliseconds from the start of the sentence. */
  t: number;
  /** The index in the text of the letter this key belongs to. */
  i: number;
}

const CLOSED: MouthShape = { open: 0, wide: 1 };
const REST: MouthShape = { open: 0.04, wide: 1 };

const SHAPES = {
  A: { open: 0.85, wide: 1 },
  E: { open: 0.4, wide: 1.08 },
  O: { open: 0.55, wide: 0.72 },
  U: { open: 0.35, wide: 0.7 },
  lip: { open: 0.1, wide: 1 },
  cons: { open: 0.28, wide: 1 },
  /** The short vowel Arabic writing leaves out. */
  schwa: { open: 0.55, wide: 1 },
} satisfies Record<string, MouthShape>;

/** One letter: its shape and how long it lasts at rate 1, and whether an Arabic short vowel follows it. */
function letter(ch: string): { shape: MouthShape; ms: number; vowelAfter?: boolean } | null {
  const c = ch.toLowerCase();
  // Arabic
  if ('اآأإىٱ'.includes(c)) return { shape: SHAPES.A, ms: 95 };
  if ('عهحغخءؤ'.includes(c)) return { shape: SHAPES.A, ms: 80 };
  if (c === 'و') return { shape: SHAPES.O, ms: 90 };
  if ('يئ'.includes(c)) return { shape: SHAPES.E, ms: 85 };
  if ('مب'.includes(c)) return { shape: CLOSED, ms: 70, vowelAfter: true };
  if (c === 'ف') return { shape: SHAPES.lip, ms: 70, vowelAfter: true };
  if ('ة'.includes(c)) return { shape: SHAPES.A, ms: 70 };
  if (/[ء-ي]/.test(c)) return { shape: SHAPES.cons, ms: 60, vowelAfter: true };
  // English
  if (c === 'a') return { shape: SHAPES.A, ms: 80 };
  if ('ei'.includes(c)) return { shape: SHAPES.E, ms: 70 };
  if (c === 'o') return { shape: SHAPES.O, ms: 80 };
  if ('uw'.includes(c)) return { shape: SHAPES.U, ms: 70 };
  if ('mbp'.includes(c)) return { shape: CLOSED, ms: 65 };
  if ('fv'.includes(c)) return { shape: SHAPES.lip, ms: 60 };
  if (c === 'y') return { shape: SHAPES.E, ms: 60 };
  if (/[a-z]/.test(c)) return { shape: SHAPES.cons, ms: 55 };
  // A digit is read as a word of a syllable or two.
  if (/[0-9٠-٩]/.test(c)) return { shape: SHAPES.A, ms: 150, vowelAfter: true };
  return null;
}

/** How long a mark keeps the mouth resting, at rate 1. */
function pause(ch: string): number {
  if ('.!?؟…\n'.includes(ch)) return 380;
  if (',،;؛:—–'.includes(ch)) return 220;
  if (/\s/.test(ch)) return 55;
  return 0;
}

/**
 * The mouth's keys for one sentence, at the voice's rate (1 is normal speed).
 * The last key closes the mouth at the end.
 */
export function mouthTimeline(text: string, rate = 1): MouthKey[] {
  const keys: MouthKey[] = [{ t: 0, i: 0, ...REST }];
  const k = 1 / Math.max(0.3, rate);
  let t = 40 * k;
  const chars = [...text];
  let index = 0;
  for (const ch of chars) {
    const l = letter(ch);
    if (l) {
      keys.push({ t, i: index, ...l.shape });
      t += l.ms * k;
      if (l.vowelAfter) {
        keys.push({ t, i: index, ...SHAPES.schwa });
        t += 55 * k;
      }
    } else {
      const p = pause(ch);
      if (p) {
        keys.push({ t, i: index, ...REST });
        t += p * k;
      }
    }
    index += ch.length;
  }
  keys.push({ t, i: text.length, ...CLOSED });
  return keys;
}

/** The mouth at a moment: straight lines between keys, closed after the last one. */
export function mouthAt(keys: MouthKey[], t: number): MouthShape {
  if (!keys.length || t <= keys[0].t) return keys[0] ?? CLOSED;
  let lo = 0;
  let hi = keys.length - 1;
  if (t >= keys[hi].t) return CLOSED;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const f = (t - a.t) / Math.max(1, b.t - a.t);
  return { open: a.open + (b.open - a.open) * f, wide: a.wide + (b.wide - a.wide) * f };
}

/** When, on the timeline, the letter at this index is said: where to jump when the voice reaches a word. */
export function timeAtChar(keys: MouthKey[], charIndex: number): number {
  for (const key of keys) if (key.i >= charIndex) return key.t;
  return keys.length ? keys[keys.length - 1].t : 0;
}

/** The whole sentence's length on the timeline, in milliseconds. */
export function timelineLength(keys: MouthKey[]): number {
  return keys.length ? keys[keys.length - 1].t : 0;
}
