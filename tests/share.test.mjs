import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DISCLAIMER, printedOn, whatsappLink } from '../src/lib/law/share.ts';

const SITE = 'https://jessy.example';
const shared = (answer = 'الإجازة 21 يوم.', extra = {}) => ({
  question: 'كام يوم إجازتي؟',
  answer,
  sources: [{ name: 'المادة 124', href: '/law/124' }],
  web: [],
  site: SITE,
  ...extra,
});
const wordsIn = (url) => decodeURIComponent(new URL(url).searchParams.get('text') ?? '');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the message carries the question, the answer, the article with its full address, the line and the site', () => {
  const url = whatsappLink(shared());
  assert.ok(url.startsWith('https://wa.me/?text='));
  const words = new URL(url).searchParams.get('text');
  for (const part of ['كام يوم إجازتي؟', 'الإجازة 21 يوم.', `المادة 124: ${SITE}/law/124`, DISCLAIMER, SITE]) {
    assert.ok(words.includes(part), part);
  }
});

test('a page from the web is sent marked as not being the law', () => {
  const words = new URL(whatsappLink(shared('جواب', { web: [{ title: 'ص', url: 'https://a.example/x' }] }))).searchParams.get('text');
  assert.ok(words.includes('من النت، مش من نص القانون: https://a.example/x'));
});

test('a long answer is cut to fit, and only the answer gives way', () => {
  const answer = 'الموظف ليه الحق في إجازة سنوية مدفوعة الأجر '.repeat(200);
  const url = whatsappLink(shared(answer));
  assert.ok(url.length <= 8_000, `the link is ${url.length}`);
  assert.ok(url.length > 7_000, `the cut wasted room, ${url.length}`);
  const words = new URL(url).searchParams.get('text');
  for (const part of ['كام يوم إجازتي؟', `المادة 124: ${SITE}/law/124`, DISCLAIMER, 'الباقي على الموقع']) {
    assert.ok(words.includes(part), part);
  }
});

test('the cut lands between words, wherever the room runs out', () => {
  const answer = 'الموظف ليه الحق في إجازة سنوية مدفوعة الأجر '.repeat(200);
  // A longer question moves the place the room runs out, so some of these fall inside a word.
  for (let extra = 0; extra < 12; extra++) {
    const words = new URL(whatsappLink(shared(answer, { question: 'س'.repeat(10 + extra) }))).searchParams.get('text');
    const kept = words.slice(words.indexOf('جيسي: '), words.indexOf('…')).trim().split(' ');
    assert.ok(answer.split(' ').includes(kept[kept.length - 1]), kept[kept.length - 1]);
  }
});

test('a short answer is left whole, with no note that it was cut', () => {
  assert.ok(!wordsIn(whatsappLink(shared())).includes('الباقي على الموقع'));
});

test('an answer with no spaces to stop at still fits', () => {
  assert.ok(whatsappLink(shared('ج'.repeat(5_000))).length <= 8_000);
});

test('a question at the longest allowed, with many articles, still leaves a link that fits', () => {
  const sources = Array.from({ length: 12 }, (_, i) => ({ name: `المادة ${i + 1}`, href: `/law/${i + 1}` }));
  const url = whatsappLink(shared('ج '.repeat(3_000), { question: 'س'.repeat(500), sources }));
  assert.ok(url.length <= 8_000, `the link is ${url.length}`);
  const words = new URL(url).searchParams.get('text');
  assert.ok(words.includes(DISCLAIMER));
  assert.ok(words.includes('المادة 5:'), 'five articles go');
  assert.ok(!words.includes('المادة 6:'), 'the rest stay on the site');
});

test('the date is Cairo\'s, in the digits the site uses', () => {
  // 23:30 in London on 4 Nov is already the 5th in Cairo.
  const date = printedOn(new Date('2026-11-04T23:30:00Z'));
  assert.match(date, /5/);
  assert.match(date, /2026/);
  assert.ok(!/[٠-٩]/.test(date), date);
});

test('the printer sees only the sheet, and the sheet has the full articles and the line', () => {
  const page = read('../src/components/chat/ask.tsx');
  const hidden = page.match(/className="[^"]*print:hidden[^"]*"/g) ?? [];
  assert.ok(hidden.some((c) => c.includes('fixed inset-0')), 'her canvas is off the paper');
  assert.ok(hidden.some((c) => c.includes('pt-[58vh]')), 'the conversation is off the paper');
  assert.ok(hidden.some((c) => c.includes('bottom-0')), 'the question box is off the paper');
  assert.match(page, /<PrintSheet sheet=\{printing\.sheet\} \/>/);
  const sheet = read('../src/components/chat/print-sheet.tsx');
  assert.match(sheet, /hidden .*print:block/);
  assert.match(sheet, /\{source\.text\}/);
  assert.match(sheet, /\{DISCLAIMER\}/);
  assert.ok(!sheet.includes('<details'), 'a closed <details> prints as just its title');
});

test('every press prints, including the same answer twice', () => {
  const page = read('../src/components/chat/ask.tsx');
  assert.match(page, /useEffect\(\(\) => \{\s*if \(printing\) window\.print\(\);\s*\}, \[printing\]\)/);
  assert.match(page, /setPrinting\(\{\s*sheet: /);
});

test('both buttons sit with the report button, under real answers only', () => {
  const page = read('../src/components/chat/ask.tsx');
  const row = page.slice(page.indexOf('{s.asked && ('), page.indexOf('<ReportWrong'));
  assert.match(row, /whatsappLink\(/);
  assert.match(row, /setPrinting\(/);
  assert.match(row, /noopener/);
});
