/*
 * Jessy's own answering, with no AI model behind it: the question is
 * normalised (Arabic spellings folded together, digits made Latin), safety
 * triggers are checked first, then the best-scoring entry of the knowledge base
 * answers. The same code runs on the server (the fallback when no model is
 * configured) and in the browser (when the server cannot be reached).
 *
 * This file imports nothing at runtime, so node runs it directly in tests/.
 */

export type Lang = 'en' | 'ar';

/** How Jessy's face looks while she gives an answer. */
export type Mood = 'happy' | 'laugh' | 'think' | 'calm' | 'surprised';

export interface KbLink {
  /** A site path ("/law") or a full URL. There is no locale segment on this site. */
  href: string;
  label: { en: string; ar: string };
}

export interface KbEntry {
  id: string;
  /** A safety entry hands over to a doctor or pharmacist; a model is never asked instead. */
  safety?: boolean;
  /**
   * Phrases (either language) that pick this entry outright, checked in the order the entries are listed.
   * English ones match whole words, and a trailing * marks a stem ("allerg*"). Arabic ones start at a
   * word, after any attached و/ف/ب/ل/ك/ال or verb prefix (بي، بت، هي…), and may take any ending.
   */
  triggers?: string[];
  /** Patterns tested against the normalised question; they pick the entry outright, like triggers. */
  patterns?: RegExp[];
  /** Words for the scored match. */
  keywords?: string[];
  /** Only for short messages ("hi", "thanks"): the entry is skipped when the question has more words. */
  maxWords?: number;
  answer: { en: string; ar: string };
  /** Other answers Jessy may give instead, one picked at random each time, so a phrasing changes. */
  more?: { en: string; ar: string }[];
  /** His face while he says it. Safety answers are always calm, and "I'm not sure" is thoughtful. */
  mood?: Mood;
  link?: KbLink;
}

export interface KbAnswer {
  id: string;
  kind: 'safety' | 'answer' | 'fallback';
  lang: Lang;
  text: string;
  mood: Mood;
  link?: { href: string; label: string; external: boolean };
}

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/** Lower case, Arabic letter variants folded (أ إ آ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي), Arabic digits made Latin. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(TASHKEEL, '')
    .replace(/ـ/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[’'`]/g, '')
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(^|\s)\.+|\.+(\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(
  (
    'a an the is are am be it its of to for and or in on at my me i you your can could do does did what whats how ' +
    'with this that please pls there tell about we he she his her they them if when which who give should would ' +
    'في من على عن الى هو هي ده دي دا انا انت انتي اللي ايه ازاي هل يا او ما مع لو كده بس عايز عايزه ممكن ' +
    'عاوز عاوزه كان هيا ليه امتي فين ايوه لا مش'
  ).split(' '),
);

/** Words for matching: stopwords dropped, Arabic's attached "the" (ال، وال، بال، فال، لل) stripped. */
export function tokens(normalised: string): string[] {
  const out: string[] = [];
  for (let w of normalised.split(' ')) {
    if (!w) continue;
    if (/^[؀-ۿ]/.test(w)) {
      w = w.replace(/^(وال|بال|فال|كال|لل|ال)(?=\S{2,})/, '');
    }
    if (w.length < 2 && !/\d/.test(w)) continue;
    if (STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

/** Arabic if the question has more Arabic letters than Latin ones. */
export function detectLang(s: string, fallback: Lang): Lang {
  const ar = (s.match(/[؀-ۿ]/g) ?? []).length;
  const la = (s.match(/[a-zA-Z]/g) ?? []).length;
  if (ar === 0 && la === 0) return fallback;
  return ar >= la ? 'ar' : 'en';
}

/** What an Arabic word may carry in front of a trigger: و or ف, then an article or a verb prefix. */
const AR_PREFIX = '(?:[وف])?(?:ال|بال|كال|لل|بي|بت|بن|هي|هت|هن|[بلكهيتن])?';

/**
 * A trigger as a pattern. "hi" must not fire on "his", nor "under 3" on "under 30"; "رجع" (vomited)
 * must not fire on "مرجع", yet "رجعت" and "بيرجع" must still fire.
 */
export function triggerPattern(raw: string): RegExp | null {
  const stem = /\*\s*$/.test(raw);
  const text = normalize(raw.replace(/\*\s*$/, ''));
  if (!text) return null;
  const esc = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = /^[a-z0-9]/.test(text) ? '(?:^|[^a-z0-9])' : `(?:^|\\s)${AR_PREFIX}`;
  const end = !stem && /[a-z0-9]$/.test(text) ? '(?![a-z0-9]|\\.\\d)' : '';
  return new RegExp(start + esc + end);
}

interface Prepared {
  entry: KbEntry;
  triggers: RegExp[];
  keyTokens: string[];
}

const prepared = new WeakMap<KbEntry[], Prepared[]>();

function prepare(entries: KbEntry[]): Prepared[] {
  let p = prepared.get(entries);
  if (!p) {
    p = entries.map((entry) => ({
      entry,
      triggers: (entry.triggers ?? []).map(triggerPattern).filter((re): re is RegExp => re !== null),
      keyTokens: [...new Set((entry.keywords ?? []).flatMap((k) => tokens(normalize(k))))],
    }));
    prepared.set(entries, p);
  }
  return p;
}

function tokenMatch(q: string, k: string): number {
  if (q === k) return 1;
  const [short, long] = q.length <= k.length ? [q, k] : [k, q];
  if (short.length >= 4 && long.startsWith(short)) return 0.75;
  return 0;
}

/** The entry that answers, or null. Exported for the tests and for the server's routing decision. */
export function match(entries: KbEntry[], question: string): KbEntry | null {
  const norm = normalize(question);
  if (!norm) return null;
  const qTokens = tokens(norm);
  const list = prepare(entries);

  for (const p of list) {
    if (p.entry.maxWords !== undefined && qTokens.length > p.entry.maxWords) continue;
    if (p.triggers.some((re) => re.test(norm))) return p.entry;
    if (p.entry.patterns?.some((re) => re.test(norm))) return p.entry;
  }

  if (!qTokens.length) return null;
  // Rarer words say more: weight each by how few entries use it.
  const df = new Map<string, number>();
  for (const p of list) for (const k of p.keyTokens) df.set(k, (df.get(k) ?? 0) + 1);
  const n = list.length;

  let best: KbEntry | null = null;
  let bestScore = 0;
  for (const p of list) {
    if (!p.keyTokens.length) continue;
    if (p.entry.maxWords !== undefined && qTokens.length > p.entry.maxWords) continue;
    let score = 0;
    for (const q of new Set(qTokens)) {
      let hit = 0;
      let weightOf = '';
      for (const k of p.keyTokens) {
        const m = tokenMatch(q, k);
        if (m > hit) {
          hit = m;
          weightOf = k;
        }
      }
      if (hit) score += hit * Math.log(1 + n / (df.get(weightOf) ?? 1));
    }
    if (score > bestScore) {
      bestScore = score;
      best = p.entry;
    }
  }
  // At least one real word in common, not just a shared prefix of a common one.
  return bestScore >= 1.2 ? best : null;
}

export function localise(link: KbLink | undefined, lang: Lang): KbAnswer['link'] {
  if (!link) return undefined;
  const external = /^https?:\/\//.test(link.href);
  // There is no locale segment on this site: the law page is /law, not /ar/law. The paths in
  // kb-data are already the real routes, so an internal href is passed through untouched — a
  // "/{locale}" prefix here sent every answer's link to a 404.
  const href = link.href.replace('{locale}', lang);
  return { href, label: link.label[lang], external };
}

/** Picks one of n answers. Random for readers; the tests pass their own. */
export type Chooser = (n: number) => number;
const randomPick: Chooser = (n) => Math.floor(Math.random() * n);

export function answerFrom(entries: KbEntry[], fallback: KbEntry, question: string, pageLang: Lang, pick: Chooser = randomPick): KbAnswer {
  const lang = detectLang(question, pageLang);
  const hit = match(entries, question);
  const entry = hit ?? fallback;
  const kind = hit ? (entry.safety ? 'safety' : 'answer') : 'fallback';
  const answers = [entry.answer, ...(entry.more ?? [])];
  const chosen = answers[Math.min(answers.length - 1, Math.max(0, Math.floor(pick(answers.length)) || 0))];
  return {
    id: entry.id,
    kind,
    lang,
    text: chosen[lang],
    mood: kind === 'safety' ? 'calm' : kind === 'fallback' ? 'think' : (entry.mood ?? 'happy'),
    link: localise(entry.link, lang),
  };
}
