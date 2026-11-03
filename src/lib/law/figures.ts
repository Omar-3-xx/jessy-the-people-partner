/*
 * The check a legal answer has to pass: every article she cites was in front of
 * her, and every figure she states can be found in what she was given.
 *
 * The law writes its figures in words ("خمسة عشر يومًا") and she says them in
 * digits ("15 يوم"), so the words are read as numbers before anything is compared.
 * A pro-rata sum from the person's own numbers ("7 شهور من 15 يوم") is legitimate
 * and is allowed by working it out here; any other figure is an invention.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

const flat = (text: string) =>
  text
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');

const UNITS: Record<string, number> = {
  واحد: 1, واحده: 1, احد: 1, احدي: 1,
  اثنان: 2, اثنين: 2, اثنتان: 2, اثنتين: 2, اثني: 2, اثنتي: 2, اثنا: 2, اتنين: 2,
  ثلاث: 3, ثلاثه: 3, تلات: 3, تلاته: 3,
  اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5,
  ست: 6, سته: 6,
  سبع: 7, سبعه: 7,
  ثمان: 8, ثماني: 8, ثمانيه: 8, تمن: 8, تمانيه: 8,
  تسع: 9, تسعه: 9,
};
const TENS: Record<string, number> = {
  عشر: 10, عشره: 10,
  عشرون: 20, عشرين: 20,
  ثلاثون: 30, ثلاثين: 30, تلاتين: 30,
  اربعون: 40, اربعين: 40,
  خمسون: 50, خمسين: 50,
  ستون: 60, ستين: 60,
  سبعون: 70, سبعين: 70,
  ثمانون: 80, ثمانين: 80, تمانين: 80,
  تسعون: 90, تسعين: 90,
  مائه: 100, مئه: 100, مايه: 100, ميه: 100,
};
/** A dual is a number in one word: "شهرين" is 2. */
const DUALS = /(?:^|\s)(?:يومين|يومان|شهرين|شهران|سنتين|سنتان|عامين|عامان|اسبوعين|اسبوعان|ساعتين|ساعتان|مرتين|مرتان|فترتين)(?=\s|$|[،.؛:])/;
/** A singular period with no number means one: "شهر" is 1. */
const SINGLES = /(?:^|\s)(?:يوم|شهر|سنه|عام|اسبوع|ساعه|مره)(?:\s+واحد\w*)?(?=\s|$|[،.؛:])/;
const TEENS = /^(?:عشر|عشره)$/;

/** Every number in a text, written either way. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const f = flat(text);
  for (const m of f.match(/\d+(?:\.\d+)?/g) ?? []) out.add(String(Number(m)));
  const words = f.split(/[^ء-ي]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/^و(?=(?:عشر|ثلاث|تلات|اربع|خمس|ست|سبع|ثمان|تمان|تسع|مائه|مئه))/, '');
    const unit = UNITS[w];
    const ten = TENS[w];
    if (unit) {
      out.add(String(unit));
      const next = words[i + 1];
      if (next && TEENS.test(next)) out.add(String(10 + unit));
      const after = next?.replace(/^و/, '');
      if (next?.startsWith('و') && after && TENS[after]) out.add(String(unit + TENS[after]));
    }
    if (ten) out.add(String(ten));
  }
  if (DUALS.test(f)) out.add('2');
  if (SINGLES.test(f)) out.add('1');
  return out;
}

/** An article the answer cites: "المادة 124", "مادة 124", "(مادة 124)", "المواد 124 و125". */
export function citedArticles(text: string): number[] {
  const latin = flat(text);
  const found = new Set<number>();
  for (const m of latin.matchAll(/(?:ماده|الماده|لماده|بالماده)\s*\(?\s*(\d{1,3})/g)) found.add(Number(m[1]));
  for (const m of latin.matchAll(/(?:مواد|المواد)\s*\(?\s*([\d\s،,و\-]+)/g)) {
    for (const n of m[1].match(/\d+/g) ?? []) found.add(Number(n));
  }
  return [...found];
}

/** A figure a reader would act on: a percentage, or a count of days, months, years, hours or pounds. */
export function statedFigures(text: string): string[] {
  const latin = flat(text);
  const out: string[] = [];
  const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`${NUMBER}\s*(?:٪|%|في الميه|في المايه|بالمايه)`, 'g'),
    new RegExp(String.raw`${NUMBER}\s*(?:يوم|ايام|شهر|شهور|اشهر|سنه|سنين|سنوات|ساعه|ساعات|اسبوع|اسابيع|مرات|مره|عامل|عمال|جنيه)`, 'g'),
    new RegExp(String.raw`(?:قانون|القانون|قرار|القرار)\s*(?:رقم\s*)?${NUMBER}`, 'g'),
  ];
  for (const re of patterns) for (const m of latin.matchAll(re)) out.push(String(Number(m[1])));
  return [...new Set(out)];
}

/** Sums she may fairly do: a share of a year, a rate on the person's own figure. */
function derived(known: Set<string>, asked: Set<string>): Set<string> {
  const out = new Set<string>();
  const round = (x: number) => [String(Math.round(x * 100) / 100), String(Math.round(x * 10) / 10), String(Math.round(x))];
  for (const a of known) {
    for (const q of asked) {
      const s = Number(a);
      const n = Number(q);
      if (!s || !n) continue;
      for (const v of [(s * n) / 12, s * n, (s * n) / 100, s + n, s - n, n - s]) {
        if (v > 0) for (const r of round(v)) out.add(r);
      }
    }
  }
  return out;
}

export type Verdict = { ok: true } | { ok: false; why: string };

/**
 * Whether an answer may be shown.
 * `sources` is what she was given, `asked` is the person's own words, `articles` the
 * articles she was allowed to cite.
 */
export function checkAnswer(answer: string, sources: string, asked: string, articles: number[]): Verdict {
  const allowedArticles = new Set(articles);
  // An article that one of her sources mentions may be named as well.
  for (const n of citedArticles(sources)) allowedArticles.add(n);
  for (const n of citedArticles(answer)) {
    if (!allowedArticles.has(n)) return { ok: false, why: `cited article ${n} she was not given` };
  }
  const known = numbersIn(sources);
  const fromPerson = numbersIn(asked);
  // The law she answers from is always nameable, and so is its year.
  const allowed = new Set([...known, ...fromPerson, '14', '2025', ...derived(known, fromPerson)]);
  for (const f of statedFigures(answer)) {
    if (!allowed.has(f)) return { ok: false, why: `stated ${f}, which is in nothing she was given` };
  }
  return { ok: true };
}
