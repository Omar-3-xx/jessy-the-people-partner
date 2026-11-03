// Cuts a clean text of Law 14/2025 into tools/law-text.json, which build-law.py then prefers over
// the PDF for the law itself. The PDF is the only source for the decrees, but its articles are
// damaged in ways no typo list can repair: article 119 prints twelve hours where the law says ten,
// article 237 stops after its first paragraph, article 143 lost its "لا". See that file's header.
//   node tools/import-law-text.mjs <the law as plain text>
import { readFileSync, writeFileSync } from 'node:fs';

const TOTAL = 298;
const ORDINALS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشر[ة]?', 'الثانية عشر[ة]?', 'الثالثة عشر[ة]?'];

const latin = (s) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const tidy = (s) =>
  latin(s)
    .replace(/\\([*_().\-[\]])/g, '$1')
    .replace(/[*#>]+/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ([،؛:.])/g, '$1')
    .replace(/\( +/g, '(')
    .replace(/ +\)/g, ')')
    .replace(/(\d) ?[-–] ?(?=[ء-ي])/g, '$1- ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

const source = latin(readFileSync(process.argv[2], 'utf8')).replace(/\r/g, '').replace(/\\([*_().\-[\]])/g, '$1').replace(/\*+/g, '');

// A heading has no sentence in it: a marker, a name, and the end of the line.
const HEADING = /^[\s*#]*\(?\s*(الكتاب|الباب|الفصل|الفرع)\s+([ء-ي]+(?: عشر)?)\s*\)?[\s*:–-]*([^\n]*)$/;
const ARTICLE = /^[\s*#]*(?:ال)?ماد[ةه]\s*\(?\s*(\d{1,3})\s*\)?\s*[:*\s]*$/;
const ISSUING = new RegExp(`^[\\s*#]*\\(?\\s*المادة\\s+(${ORDINALS.join('|')})\\s*\\)?[\\s*:]*$`);

const records = [];
const where = { book: '', part: '', chapter: '' };
let current = null;
let next = 1;
let pendingTitle = null;

const close = () => {
  if (!current) return;
  // The page breaks some sentences across lines; a new line is only kept where a sentence or an item ends.
  current.text = tidy(current.lines.join('\n')).replace(/([^.:؛])\n(?!\d+[- ])/g, '$1 ');
  delete current.lines;
  records.push(current);
  current = null;
};

for (const raw of source.split('\n')) {
  const line = raw.trim();
  if (!line) continue;
  const issuing = line.match(ISSUING);
  if (issuing && next === 1) {
    close();
    current = { kind: 'issuing', label: issuing[1], lines: [] };
    continue;
  }
  const article = line.match(ARTICLE);
  if (article && Number(article[1]) === next) {
    close();
    current = { kind: 'law', n: next, ...where, lines: [] };
    next++;
    pendingTitle = null;
    continue;
  }
  const heading = line.match(HEADING);
  if (heading && line.length < 140) {
    close();
    const title = `${heading[1]} ${heading[2]}${heading[3] ? `: ${tidy(heading[3])}` : ''}`;
    if (heading[1] === 'الكتاب') Object.assign(where, { book: title, part: '', chapter: '' });
    else if (heading[1] === 'الباب') Object.assign(where, { part: title, chapter: '' });
    else if (heading[1] === 'الفصل') where.chapter = title;
    pendingTitle = heading[3] ? null : heading[1];
    continue;
  }
  // A heading whose name sits on the line under it.
  if (pendingTitle && !current) {
    const key = pendingTitle === 'الكتاب' ? 'book' : pendingTitle === 'الباب' ? 'part' : pendingTitle === 'الفصل' ? 'chapter' : null;
    if (key) where[key] = `${where[key]}: ${tidy(line)}`;
    pendingTitle = null;
    continue;
  }
  // The page's share buttons come straight after the last article.
  if (/شارك المقالة/.test(line)) {
    close();
    break;
  }
  current?.lines.push(line);
}
close();

const law = records.filter((r) => r.kind === 'law');
if (law.length !== TOTAL) throw new Error(`${law.length} articles, not ${TOTAL}; stopped at ${next}`);
const empty = records.filter((r) => r.text.length < 20).map((r) => r.n ?? r.label);
if (empty.length) throw new Error(`no text: ${empty.join(', ')}`);

writeFileSync(new URL('./law-text.json', import.meta.url), `${JSON.stringify(records, null, 0)}\n`);
console.log(`${law.length} articles, ${records.length - law.length} issuing`);
