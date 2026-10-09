/*
 * The last word on what a model may say as Jessy.
 *
 * The danger on a site about the law is not rudeness, it is a confident
 * invented citation: "المادة 139 بتديك 20 يوم" reads exactly like a real
 * answer. So the guard's main rule is arithmetic, not taste — a reply that
 * states ANY legal figure of its own (an article number, a law number, a count
 * of days or months, a percentage) is thrown away and the knowledge base's own
 * answer is sent instead. Only figures that already appeared in the
 * conversation may be repeated back.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

const FORBIDDEN: RegExp[] = [
  // Never out of character.
  /\b(as an ai|language model|system prompt|my instructions|anthropic|claude|chat\s?gpt|openai|gpt|gemini|google)\b/i,
  /((ال)?ذكاء\s*(ال)?اصطناعي|نموذج\s*(لغوي|ذكاء)|تعليماتي|البرومبت)/,
  // Never a lawyer, never a verdict on someone's case.
  /(أنا\s*محامي|كمحامي|استشارتي\s*القانونية|رأيي\s*القانوني)/,
  /(هتكسب|هتخسر|ارفع\s*قضية|اشتكي\s*عليه|حقك\s*ضاع|ده\s*مخالف\s*للقانون)/,
  // No links and no phone numbers: the site adds its own.
  /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|eg|io|gov)\b)/i,
  /(\+?\d[\d\s-]{8,}\d)/,
];

/** Every number in the text, Arabic-Indic digits counted as their Latin value. */
function numbersIn(text: string): string[] {
  const latin = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  return (latin.match(/\d+/g) ?? []).map((n) => String(Number(n)));
}

/**
 * A legal figure the reply states: an article, a law, a decree, a count of days
 * or months or years, or a percentage. These are the claims a reader will act
 * on, so each one must have come from the conversation, not from the model.
 */
export function legalFigures(text: string): string[] {
  const latin = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const out: string[] = [];
  const patterns = [
    /(?:ماده|مادة|المادة)\s*\(?\s*(\d+)/g,
    /(?:قانون|القانون|قرار|القرار)\s*(?:رقم\s*)?(\d+)/g,
    /(?:لسنة|لعام)\s*(\d+)/g,
    /(\d+)\s*(?:٪|%)/g,
    /(\d+)\s*(?:يوم|أيام|ايام|شهر|شهور|أشهر|اشهر|سنة|سنين|سنوات|ساعة|ساعات|مرات|مرة)/g,
  ];
  for (const re of patterns) for (const m of latin.matchAll(re)) out.push(String(Number(m[1])));
  return [...new Set(out)];
}

/**
 * True when the reply states a legal figure that nothing in `allowed` mentions.
 * `allowed` is the conversation so far: the question and the earlier turns.
 */
export function inventsFigures(reply: string, allowed: string): boolean {
  const known = new Set(numbersIn(allowed));
  return legalFigures(reply).some((n) => !known.has(n));
}

export function breaksPersona(text: string): boolean {
  return FORBIDDEN.some((re) => re.test(text));
}

/** Emoji are dropped except 🌟, and only the first of those is kept. */
export function tidyEmoji(text: string): string {
  let kept = false;
  return text
    .replace(/\p{Extended_Pictographic}️?(‍\p{Extended_Pictographic}️?)*/gu, (e) => {
      if (!kept && e.replace(/️/g, '') === '🌟') {
        kept = true;
        return '🌟';
      }
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?،؟])/g, '$1')
    .trim();
}

/*
 * A vocative that decides, for the reader, which sex they are.
 *
 * Nothing on this site asks a visitor whether they are a man or a woman, and nothing infers it,
 * so "أهلاً بك يا زميلي" is a guess presented as a greeting -- on a site whose subject is
 * maternity, nursing and child care, a guess that is wrong a great deal of the time. ask-prompt.ts
 * asks her not to write one; this is the half of that which can be checked instead of asked for.
 *
 * The reply is NOT thrown away for it, unlike an invented article number. "أهلاً بك يا زميلي"
 * is a good answer carrying one wrong word, so the word goes and the answer stays. Only the
 * calling form is touched; the rest of the sentence is hers.
 *
 * It matches the vocative "يا" and nothing else, because that particle is what makes these words
 * a form of address. Without it "أختي" and "زميلي" are ordinary nouns a person may be asking
 * about -- a sister's leave, a colleague's leave -- and striking those would edit her meaning.
 * "يا فندم" is deliberately absent: it is polite and it commits to nothing.
 */
const GENDERED_CALL =
  /[ 	]*يا\s+(?:زميلي|زميلتي|أستاذ|أستاذة|استاذ|استاذة|مدام|آنسة|انسة|أخي|اخي|أختي|اختي|حبيبي|حبيبتي|عزيزي|عزيزتي|باشا|هانم|بيه)(?![ء-ي])/g;

/** Her reply with any such vocative taken out, and the spacing closed up behind it. */
export function dropGenderedCall(text: string): string {
  return text
    .replace(GENDERED_CALL, '')
    // The vocative alone is taken, so its comma is left behind: "يا أستاذ، الإجازة" must not
    // open on a comma, while "بك يا زميلي، ممكن" keeps the one that was doing work.
    .replace(/^[\s،,.!?؟]+/, '')
    .replace(/[ 	]{2,}/g, ' ')
    .replace(/ +([.,!?،؟])/g, '$1')
    .trim();
}

/**
 * A model's reply made fit to send, or null when it must not be sent at all.
 * `context` is everything the person and the site have already said; a figure
 * outside it is an invention and throws the whole reply away.
 */
export function guardReply(raw: string, context = '', maxChars = 600): string | null {
  const text = raw.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!text || breaksPersona(text) || inventsFigures(text, context)) return null;
  const tidy = dropGenderedCall(tidyEmoji(text));
  if (!tidy) return null;
  if (tidy.length <= maxChars) return tidy;
  const cut = tidy.slice(0, maxChars);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('؟ '), cut.lastIndexOf('\n'));
  return end > maxChars / 2 ? cut.slice(0, end + 1).trim() : null;
}
