/*
 * An answer leaving the site: to WhatsApp as a link, to paper as a printed sheet. Either way it
 * keeps the articles it stands on and the line saying it is not legal advice, because this is the
 * moment someone shows it to their manager.
 *
 * The link only opens the person's own WhatsApp with the words filled in. Nothing passes through
 * the site. It costs nothing and needs no account, which the WhatsApp API does not promise.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

export const DISCLAIMER = 'ده شرح لنص القانون، مش استشارة قانونية.';

/*
 * Measured on wa.me on 4 Nov 2026: 10,757 characters of link reached the page with the text intact,
 * 16,127 did not. Arabic costs six characters per letter once encoded, so this is about 1,400
 * letters. Kept below what was measured, because a phone's browser is not the machine it was
 * measured on.
 */
const MAX_LINK = 8_000;
const MAX_ARTICLES = 5;
const CUT = '… (الباقي على الموقع)';

export type Shared = {
  question: string;
  answer: string;
  sources: { name: string; href: string }[];
  web: { title: string; url: string }[];
  /** The site's own address, which the article links are built on. */
  site: string;
};

const link = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

function compose(shared: Shared, answer: string): string {
  const articles = shared.sources.slice(0, MAX_ARTICLES).map((s) => `${s.name}: ${shared.site}${s.href}`);
  const web = shared.web.slice(0, 2).map((p) => `من النت، مش من نص القانون: ${p.url}`);
  return [
    `سؤالي: ${shared.question}`,
    `جيسي: ${answer}`,
    ...(articles.length ? [articles.join('\n')] : []),
    ...(web.length ? [web.join('\n')] : []),
    DISCLAIMER,
    shared.site,
  ].join('\n\n');
}

/** Too long for a link, the answer gives way. The question, the articles and the disclaimer never do. */
export function whatsappLink(shared: Shared): string {
  const whole = link(compose(shared, shared.answer));
  if (whole.length <= MAX_LINK) return whole;
  let low = 0;
  let high = shared.answer.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (link(compose(shared, shared.answer.slice(0, middle) + CUT)).length <= MAX_LINK) low = middle;
    else high = middle - 1;
  }
  // Not in the middle of a word, unless the answer has no spaces to stop at.
  const space = shared.answer.lastIndexOf(' ', low);
  const end = space > low / 2 ? space : low;
  return link(compose(shared, shared.answer.slice(0, end).trimEnd() + CUT));
}

/** Today in Cairo with the digits the rest of the site uses. */
export function printedOn(now = new Date()): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'long' }).format(now);
}
