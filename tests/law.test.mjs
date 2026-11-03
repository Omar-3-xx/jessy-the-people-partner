import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { checkAnswer, citedArticles, numbersIn, statedFigures } from '../src/lib/law/figures.ts';
import { buildIndex, namedArticles, normalise, search, tokens } from '../src/lib/law/search.ts';
import { wantsWeb } from '../src/lib/law/web.ts';

const records = JSON.parse(readFileSync(new URL('../src/lib/law/law-data.json', import.meta.url), 'utf8'));
const index = buildIndex(records);
const article = (n) => records.find((r) => r.kind === 'law' && r.n === n);

test('the whole law is there: 298 articles, in order, each with its text', () => {
  const law = records.filter((r) => r.kind === 'law');
  assert.equal(law.length, 298);
  law.forEach((r, i) => {
    assert.equal(r.n, i + 1);
    assert.ok(r.text.length >= 15, `article ${r.n} is empty`);
  });
});

test('the decrees came with it', () => {
  const decrees = new Set(records.filter((r) => r.kind === 'decree').map((r) => r.decree));
  assert.ok(decrees.size >= 23, `only ${decrees.size} decrees`);
  for (const d of [49, 294, 291]) assert.ok(decrees.has(d), `decree ${d} is missing`);
});

test('the figures she relies on read as the law printed them', () => {
  for (const figure of ['خمسة عشر', 'واحد وعشرون', 'ثلاثون', 'خمسة وأربعون', 'سبعة أيام']) {
    assert.ok(article(124).text.includes(figure), `124 has lost ${figure}`);
  }
  assert.match(article(121).text, /35٪/);
  assert.match(article(121).text, /70٪/);
  assert.match(article(166).text, /عشرين يومًا/);
});

test('spelling never decides what is found', () => {
  assert.equal(normalise('إجازة'), normalise('اجازه'));
  assert.deepEqual(tokens('الإجازة'), tokens('اجازه'));
  assert.deepEqual(namedArticles('ايه هي الماده ١٢٤؟'), [124]);
  assert.deepEqual(namedArticles('المادة 999'), []);
});

/** [what someone types, an article that must be among the first eight found] */
const FOUND = [
  ['اترفدت من غير سبب، حقوقي إيه؟', 165],
  ['كام يوم إجازة سنوية ليا؟', 124],
  ['الأوفر تايم بيتحسب إزاي؟', 121],
  ['مديري رافض يديني إجازتي، أعمل إيه؟', 125],
  ['الإجازة اللي مخدتهاش بتتحول فلوس؟', 125],
  ['غبت كام يوم يبقى مستقيل؟', 166],
  ['عايز أقدم استقالتي، الخطوات إيه؟', 167],
  ['ينفع يفصلوني وأنا عيان؟', 173],
];

test('the questions that used to go wrong now reach their article', () => {
  for (const [question, n] of FOUND) {
    const found = search(index, question, 8).map((h) => h.record.n);
    assert.ok(found.includes(n), `«${question}» did not find ${n}: ${found.join(', ')}`);
  }
});

test('an article named outright is always first', () => {
  assert.equal(search(index, 'إيه هي المادة 166؟', 8)[0].record.n, 166);
});

test('a figure written in words reads as that number', () => {
  const seen = numbersIn(article(124).text);
  for (const n of ['15', '21', '30', '45', '7', '6', '10', '50']) assert.ok(seen.has(n), `124 does not read as ${n}`);
  assert.ok(numbersIn('خلال شهرين من التاريخ').has('2'));
  assert.ok(numbersIn('اثنتي عشرة ساعة').has('12'));
});

test('she may say what the article says', () => {
  const answer = 'المادة 124 بتقول 15 يوم في أول سنة، و21 يوم من السنة التانية.';
  assert.deepEqual(citedArticles(answer), [124]);
  assert.deepEqual(checkAnswer(answer, article(124).text, 'كام يوم؟', [124]), { ok: true });
});

test('an article she was not given is an invention', () => {
  const verdict = checkAnswer('المادة 47 بتديك 15 يوم.', article(124).text, 'كام يوم؟', [124]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /47/);
});

test('the old law is caught: figures from 12/2003 are in nothing she was given', () => {
  // 12/2003 gave 25% and 50% for overtime, and those figures are all over the internet.
  const verdict = checkAnswer('المادة 121: 25% عن ساعة النهار.', article(121).text, 'الأوفر تايم؟', [121]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /25/);
});

test('a share of a year worked out from the person\'s own months is allowed', () => {
  const answer = 'المادة 124: ليك 8.75 يوم عن 7 شهور.';
  assert.deepEqual(statedFigures(answer).sort(), ['7', '8.75']);
  assert.deepEqual(checkAnswer(answer, article(124).text, 'اشتغلت 7 شهور، ليا كام يوم؟', [124]), { ok: true });
});

test('a law question that needs today\'s figure goes to the web', () => {
  assert.equal(wantsWeb('الحد الأدنى للأجور كام دلوقتي؟', 50), true);
  assert.equal(wantsWeb('نسبة التأمينات كام؟', 50), true);
  assert.equal(wantsWeb('كام يوم إجازة سنوية ليا؟', 50), false);
  assert.equal(wantsWeb('سؤال بعيد خالص', 1), true);
});

/** The exam's questions as the site would embed them (tools/build-law-vectors.mjs), or none if not built. */
function askedVector(id) {
  const file = new URL('./law-exam-vectors.json', import.meta.url);
  if (!existsSync(file)) return null;
  askedVector.all ??= JSON.parse(readFileSync(file, 'utf8'));
  const data = askedVector.all[id];
  if (!data) return null;
  return [...new Int8Array(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer)];
}

test('the exam: the right article is among what she reads', { skip: !existsSync(new URL('./law-exam.json', import.meta.url)) }, () => {
  const exam = JSON.parse(readFileSync(new URL('./law-exam.json', import.meta.url), 'utf8')).filter((q) => !q.outside);
  const vectors = JSON.parse(readFileSync(new URL('../src/lib/law/law-vectors.json', import.meta.url), 'utf8'));
  const siteIndex = buildIndex(records, vectors);
  assert.ok(siteIndex.meaning, 'the vectors were built from a different law: run tools/build-law-vectors.mjs');
  const missed = [];
  for (const q of exam) {
    const hits = search(siteIndex, q.q, 12, askedVector(q.id));
    const found = new Set(hits.map((h) => h.record.n));
    for (const h of hits) if (h.record.under) found.add(h.record.under);
    const decrees = new Set(hits.map((h) => h.record.decree));
    const lawOk = !q.articles?.length || (q.any ? q.articles.some((n) => found.has(n)) : found.has(q.articles[0]));
    const decreeOk = !q.decrees?.length || q.decrees.some((d) => decrees.has(d));
    if (!lawOk || !decreeOk) missed.push(q.id);
  }
  const score = 1 - missed.length / exam.length;
  assert.ok(score >= EXAM_FLOOR, `${(score * 100).toFixed(1)}% of ${exam.length}, missed ${missed.join(' ')}`);
});

const EXAM_FLOOR = 0.95;
