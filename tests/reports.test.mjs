import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { cleanReport, reportsFrom, saveReport } from '../src/lib/law/reports.ts';

/** The same calls D1 takes, over a real SQL database, so the SQL itself is what is tested. */
function database() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, values = []) => ({ sql, values, bind: (...next) => statement(sql, next) });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    batch: async (list) => list.map((s) => ({ meta: { changes: Number(sqlite.prepare(s.sql).run(...s.values).changes) } })),
  };
}

const REPORT = { question: 'سؤال', answer: 'إجابة', articles: ['المادة 124'], note: 'ملاحظة' };
const rows = (db) => db.sqlite.prepare('SELECT * FROM reports').all();

test('a report is kept with its date, and the table is made the first time', async () => {
  const db = database();
  assert.equal(await saveReport(db, REPORT, new Date('2026-11-04T08:00:00Z')), true);
  assert.equal(await saveReport(db, REPORT), true, 'the second one finds the table there');
  const [row] = rows(db);
  assert.equal(rows(db).length, 2);
  assert.equal(row.at, '2026-11-04T08:00:00.000Z');
  assert.equal(row.question, 'سؤال');
  assert.equal(row.answer, 'إجابة');
  assert.deepEqual(JSON.parse(row.articles), ['المادة 124']);
  assert.equal(row.note, 'ملاحظة');
});

test('there is nowhere to keep who sent it', async () => {
  const db = database();
  await saveReport(db, REPORT);
  const columns = db.sqlite.prepare('PRAGMA table_info(reports)').all().map((c) => c.name);
  assert.deepEqual(columns, ['id', 'at', 'question', 'answer', 'articles', 'note']);
});

test('the page is never told it arrived when it did not', async () => {
  const broken = { ...database(), batch: async () => { throw new Error('D1 is down'); } };
  assert.equal(await saveReport(broken, REPORT), false);
});

test('once the database has its fill it stops growing, and says so', async () => {
  const db = database();
  await saveReport(db, REPORT);
  db.sqlite.exec(`WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i + 1 FROM n WHERE i < 5000)
    INSERT INTO reports (at, question, answer, articles, note) SELECT 'x', 'q', 'a', '[]', '' FROM n`);
  assert.equal(rows(db).length, 5000);
  assert.equal(await saveReport(db, REPORT), false);
  assert.equal(rows(db).length, 5000);
});

test('what the page sends is cut to size, and junk is turned away', () => {
  const big = cleanReport({
    question: ` ${'س'.repeat(600)} `,
    answer: 'ج'.repeat(5_000),
    note: 'م'.repeat(400),
    articles: [...Array(30).fill('المادة 1'), 7, '', 'م'.repeat(100)],
  });
  assert.equal(big.question.length, 500);
  assert.equal(big.answer.length, 4_000);
  assert.equal(big.note.length, 300);
  assert.equal(big.articles.length, 20);

  assert.deepEqual(cleanReport({ question: 'س', answer: 'ج', articles: 'not a list', ip: '1.2.3.4', name: 'x' }), {
    question: 'س',
    answer: 'ج',
    articles: [],
    note: '',
  });
  assert.deepEqual(cleanReport({ question: 'س', answer: 'ج', articles: [7, '', 'المادة 1'] }).articles, ['المادة 1']);

  for (const junk of [null, 'text', {}, { question: 'س' }, { answer: 'ج' }, { question: '  ', answer: 'ج' }, { question: 1, answer: 2 }]) {
    assert.equal(cleanReport(junk), null);
  }
});

test('no database binding means no report, not a crash', () => {
  for (const env of [null, undefined, {}, { REPORTS: {} }]) assert.equal(reportsFrom(env), null);
  const db = database();
  assert.equal(reportsFrom({ REPORTS: db }), db);
});

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the route asks for proof first, and the worker is given the database', () => {
  const route = read('../src/app/api/report/route.ts');
  assert.ok(route.indexOf('checkHuman(req') > 0 && route.indexOf('checkHuman(req') < route.indexOf('await receive(req)'));
  const wrangler = read('../wrangler.jsonc');
  assert.match(wrangler, /"binding": "REPORTS"/);
  assert.match(wrangler, /"database_id": "dc7ae8d5-c77d-4984-a03b-fb041bf72e4a"/);
});

test('nothing is sent until the person has read what will be sent and pressed send', () => {
  const button = read('../src/components/chat/report-wrong.tsx');
  assert.match(button, /useState<Step>\('closed'\)/);
  assert.match(button, /onClick=\{\(\) => setStep\('confirm'\)\}/);
  assert.match(button, /onClick=\{\(\) => void send\(\)\}/);
  assert.equal(button.match(/postAsHuman\(/g).length, 1);
  assert.match(button, /متكتبش اسمك/);
  assert.ok(button.indexOf('postAsHuman(') < button.indexOf("if (step === 'closed')"), 'only inside send()');
});

test('the button sits under her real answers, and the limits page says what is kept', () => {
  const page = read('../src/components/chat/ask.tsx');
  assert.ok(page.indexOf('{s.asked && (') > 0 && page.indexOf('{s.asked && (') < page.indexOf('<ReportWrong'));
  assert.match(page, /asked: q/);
  assert.match(read('../src/app/law/page.tsx'), /الإجابة دي غلط/);
});
