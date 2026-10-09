/*
 * Tigo's voice, the parts that need no browser: which of the device's voices
 * he speaks with, how his words are cleaned up to be read aloud, and how a
 * reply is cut into sentences (a browser voice reads a short sentence more
 * reliably than a long reply, and each sentence gets its own lip sync).
 *
 * The voices are the browser's own, free, on the device or the browser
 * maker's service: Edge offers natural Egyptian voices ("Salma", "Shakir"),
 * Safari and Chrome offer others. Nothing here sends anything anywhere.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

export type VoiceLang = 'en' | 'ar';

/** What this file needs of a SpeechSynthesisVoice. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

/** The locale Tigo listens and speaks in, for each language of the site: Egyptian Arabic, and English. */
export const LOCALE: Record<VoiceLang, string> = { ar: 'ar-EG', en: 'en-US' };

/**
 * Voices known to suit a cub, best first. A child's voice, or a light one raised
 * a little, sounds more like a six-year-old than a man's voice raised a lot.
 */
const PREFERRED: Record<VoiceLang, RegExp[]> = {
  ar: [/\bSalma\b/i, /\bShakir\b/i, /\bLaila\b/i, /\bMaged\b/i],
  en: [/\bAna\b/i, /\bJenny\b/i, /\bAria\b/i, /\bSamantha\b/i, /Google US English/i],
};

const NATURAL = /natural|neural|online|premium|enhanced/i;

/** How well a voice suits Tigo in this language; 0 when it cannot speak the language at all. */
export function voiceScore(voice: VoiceLike, lang: VoiceLang): number {
  const tag = voice.lang.replace('_', '-').toLowerCase();
  const want = LOCALE[lang].toLowerCase();
  if (!tag.startsWith(lang)) return 0;
  let score = tag === want ? 40 : 20;
  if (NATURAL.test(voice.name)) score += 12;
  const pref = PREFERRED[lang].findIndex((re) => re.test(voice.name));
  if (pref >= 0) score += 10 - pref;
  return score;
}

/** The device's best voice for Tigo in this language, or null when it has none. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: VoiceLang): V | null {
  let best: V | null = null;
  let bestScore = 0;
  for (const v of voices) {
    const s = voiceScore(v, lang);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

/** How high Tigo's voice is set: a child's voice as it is, any other a little higher. */
export function pitchFor(voice: VoiceLike | null): number {
  if (voice && /\bAna\b/i.test(voice.name)) return 1.1;
  return 1.3;
}

/**
 * The Arabic voices that speak the Egyptian way, saying ج as the hard g of "Tigo". Every other Arabic
 * voice says it as the j of "jam", so Tigo became "Teejo". That was measured on 2026-09-19 with Windows'
 * own Egyptian voice, Hoda, which Chrome uses: «تيجو» and «جمل» carry a j's long hiss, while «غ» gives
 * a g's stop with no hiss. Persian «گ» she barely says at all.
 */
const EGYPTIAN_G = /\b(Salma|Shakir)\b/i;

/** Whether this voice says ج as a hard g. */
export function saysHardJeem(voice: VoiceLike | null | undefined): boolean {
  return !!voice && EGYPTIAN_G.test(voice.name);
}

/**
 * A reply as it should be heard: no emoji, symbols read as words, and Tigo's name and TigoGrow's said
 * as the owner says them: "Tee-go" and "Tee-go Grow" (2026-09-19).
 */
export function speakable(text: string, lang: VoiceLang, voice?: VoiceLike | null): string {
  let s = text
    .replace(/\p{Extended_Pictographic}️?(‍\p{Extended_Pictographic}️?)*/gu, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/TigoGrow/g, 'Tigo Grow')
    // A range of numbers is read before any other dash becomes a pause.
    .replace(/(\d)\s*[–-]\s*(\d)/g, lang === 'ar' ? '$1 إلى $2' : '$1 to $2')
    .replace(/[—–]/g, ', ')
    .replace(/[“”«»"]/g, '');
  if (lang === 'ar') {
    // A voice that would say "j" gets «غ», its nearest hard g. Written plainly, «جرو» is the Arabic word for
    // a puppy, so "Grow" carries its vowels. A Latin name is never left in: Hoda says nothing at all for it.
    const g = saysHardJeem(voice) ? 'ج' : 'غ';
    s = s
      .replace(/Tigo Grow|تيجو جرو/g, `تي${g}و ${g}ْرُو`)
      .replace(/Tigo|تيجو/g, `تي${g}و`)
      .replace(/(\d)\s*°\s*C/gi, '$1 درجة')
      .replace(/(\d)\s*(mL|ml)\b/g, '$1 مللي')
      .replace(/(\d)\s*مل(?![ء-ي])/g, '$1 مللي');
  } else {
    s = s
      // English voices read "Tigo" as "Tie-go", like "tiger" (Windows' voices, measured 2026-09-19).
      .replace(/\bTigo\b/g, 'Teego')
      .replace(/(\d)\s*°\s*C/gi, '$1 degrees')
      .replace(/(\d)\s*mL\b/gi, '$1 millilitres')
      .replace(/(\d)\s*cm\b/g, '$1 centimetres');
  }
  return s.replace(/[ \t]+/g, ' ').replace(/ ([,.!?،؟])/g, '$1').trim();
}

const ENDS = '.!?؟…';

/**
 * A reply cut into sentences, each keeping its own mark. A point between digits (2.5) ends nothing.
 */
export function sentences(text: string): string[] {
  const pieces: string[] = [];
  let cur = '';
  const push = () => {
    const p = cur.trim();
    if (p) pieces.push(p);
    cur = '';
  };
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') {
      push();
      continue;
    }
    cur += ch;
    const decimal = ch === '.' && /\d/.test(chars[i - 1] ?? '') && /\d/.test(chars[i + 1] ?? '');
    if (ENDS.includes(ch) && !decimal && !ENDS.includes(chars[i + 1] ?? '')) push();
  }
  push();
  // A piece with nothing to say ("…") joins the sentence before it.
  const out: string[] = [];
  for (const p of pieces) {
    if (!/[\p{L}\p{N}]/u.test(p) && out.length) out[out.length - 1] += ` ${p}`;
    else if (/[\p{L}\p{N}]/u.test(p)) out.push(p);
  }
  return out;
}

/** After a question, Tigo waits a moment, as a child does before a punchline; after a "hmm…", he thinks. */
export function pauseAfter(sentence: string): number {
  if (/[?؟]$/.test(sentence)) return 900;
  return /…$/.test(sentence) ? 600 : 120;
}
