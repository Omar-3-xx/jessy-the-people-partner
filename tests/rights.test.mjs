import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { addMonths, ending, leave, notice, overtime } from '../src/lib/law/rights.ts';
import { readAmount } from '../src/lib/numbers.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const LAW = JSON.parse(read('../src/lib/law/law-data.json'));
const article = (n) => LAW.find((r) => r.kind === 'law' && r.n === n);

const person = (extra) => ({ serviceMonths: 36, over50: false, disability: false, hazardous: false, ...extra });

test('leave follows the four lines of article 124', () => {
  assert.equal(leave(person({ serviceMonths: 12 })).annual, 21, 'from the second year');
  assert.equal(leave(person({ serviceMonths: 11 })).annual, 15, 'the first year');
  assert.equal(leave(person({ serviceMonths: 120 })).annual, 30, 'ten full years here');
  assert.equal(leave(person({ serviceMonths: 119 })).annual, 21, 'not yet ten');
  assert.equal(leave(person({ serviceMonths: 24, allYears: 10 })).annual, 30, 'ten years with any employer');
  assert.equal(leave(person({ over50: true })).annual, 30);
  assert.equal(leave(person({ disability: true, over50: true })).annual, 45, 'the highest line wins');
});

test('hazardous work adds seven days in every case', () => {
  assert.equal(leave(person({ hazardous: true })).annual, 28);
  assert.equal(leave(person({ hazardous: true, disability: true })).annual, 52);
});

test('under six months nothing is due yet, and under a year it is pro rata, marked as practice', () => {
  const early = leave(person({ serviceMonths: 5 }));
  assert.equal(early.entitled, 0);
  assert.equal(early.balance, 0);
  const nine = leave(person({ serviceMonths: 9 }));
  assert.equal(nine.entitled, 11.25);
  assert.ok(nine.notes.some((n) => n.includes('ممارسة عملية')));
  assert.equal(leave(person({ serviceMonths: 6 })).entitled, 7.5);
});

test('the balance and what it is worth, with the month\'s days said out loud', () => {
  const result = leave(person({ usedDays: 6, carriedDays: 5, monthlyWage: 6_000 }));
  assert.equal(result.balance, 20);
  assert.equal(result.pay, 4_000);
  assert.ok(result.notes.some((n) => n.includes('30 يوم')));
  assert.deepEqual(result.articles, [124, 125, 108]);
  assert.equal(leave(person({ monthlyWage: 6_000, daysInMonth: 26 })).pay, 4_846.15);
  assert.equal(leave(person({ usedDays: 40 })).balance, 0, 'never below nothing');
  assert.equal(leave(person()).pay, null, 'no wage, no value');
});

test('overtime: 35% by day, 70% by night, a day\'s wage for a rest day, on the hourly wage', () => {
  const result = overtime({ monthlyWage: 6_000, dayHours: 10, nightHours: 2, restDays: 1 });
  assert.equal(result.hourly, 25);
  assert.equal(result.dayPay, 337.5);
  assert.equal(result.nightPay, 85);
  assert.equal(result.restPay, 200);
  assert.equal(result.total, 622.5);
  assert.ok(result.notes.some((n) => n.includes('يوم تاني بدله')), 'the replacement day is not lost');
  assert.ok(result.notes.some((n) => n.includes('محددش')), 'the assumption is stated');
  assert.equal(overtime({ monthlyWage: 6_000, daysInMonth: 25, hoursInDay: 6, dayHours: 1 }).hourly, 40);
  assert.equal(overtime({ monthlyWage: 0 }), null);
});

test('notice: three months on an open contract, from the day it was received', () => {
  const byEmployer = notice({ contract: 'open', by: 'employer', received: '2026-11-04', servedMonths: 1, monthlyWage: 6_000 });
  assert.equal(byEmployer.months, 3);
  assert.equal(byEmployer.ends, '2027-02-04');
  assert.equal(byEmployer.owed, 12_000, 'the two months not given');
  assert.ok(byEmployer.articles.includes(164));
  assert.ok(byEmployer.articles.includes(162), 'the job-hunting day');

  const byWorker = notice({ contract: 'open', by: 'worker', monthlyWage: 6_000 });
  assert.equal(byWorker.months, 3);
  assert.equal(byWorker.owed, null, 'the employer owes this only when the employer cut it');
  assert.ok(byWorker.articles.includes(167));

  const fixed = notice({ contract: 'fixed', by: 'employer', received: '2026-11-04' });
  assert.equal(fixed.months, 0);
  assert.equal(fixed.ends, null);
});

test('notice dates survive short months, leap years and nonsense', () => {
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonths('2027-11-30', 3), '2028-02-29');
  assert.equal(addMonths('2026-12-15', 3), '2027-03-15');
  assert.equal(addMonths('2026-02-31', 3), null);
  assert.equal(addMonths('not a date', 3), null);
});

test('the end of the job: each way it ends has its own sum', () => {
  const unlawful = ending({ how: 'unlawful', years: 4, monthlyWage: 6_000 });
  assert.equal(unlawful.amount, 48_000);
  assert.equal(unlawful.atLeast, true, 'a minimum, and a court decides');
  assert.ok(unlawful.notes.some((n) => n.includes('المحكمة')));
  assert.deepEqual(unlawful.articles.slice(0, 2), [165, 168]);

  assert.equal(ending({ how: 'fixedOverFive', years: 6, monthlyWage: 6_000 }).amount, 36_000);

  assert.equal(ending({ how: 'afterSixty', years: 3, monthlyWage: 6_000 }).amount, 9_000, 'half a month a year');
  assert.equal(ending({ how: 'afterSixty', years: 7, monthlyWage: 6_000 }).amount, 27_000, 'then a month a year');

  const resigned = ending({ how: 'resigned', years: 10, monthlyWage: 6_000 });
  assert.equal(resigned.amount, 0);
  assert.ok(resigned.articles.includes(125), 'but the leave balance is still theirs');
});

test('part of a year is counted pro rata, and says that is an estimate', () => {
  const result = ending({ how: 'unlawful', years: 1, months: 6, monthlyWage: 1_000 });
  assert.equal(result.amount, 3_000);
  assert.ok(result.notes.some((n) => n.includes('تقدير')));
  assert.ok(!ending({ how: 'unlawful', years: 1, monthlyWage: 1_000 }).notes.some((n) => n.includes('الكسور')));
});

test('the law still says what these sums assume', () => {
  const says = (n, ...parts) => {
    for (const part of parts) assert.ok(article(n).text.includes(part), `article ${n}: ${part}`);
  };
  says(124, 'خمسة عشر يومًا', 'واحد وعشرون يومًا', 'ثلاثون يومًا', 'عشر سنوات كاملة', 'خمسين عامًا', 'خمسة وأربعون يومًا', 'ستة أشهر', 'سبعة أيام');
  says(125, 'الأجر المقابل لهذا الرصيد', 'كل ثلاث سنوات', 'سقط حقه');
  says(121, '(35٪)', '(70٪)', 'يوم الراحة', 'اثنتى عشرة ساعة');
  says(117, 'ثمانى ساعات');
  says(156, 'بثلاثة أشهر', 'كتابة');
  says(158, 'من تاريخ تسلمه');
  says(159, 'خلال إجازاته', 'إجازة مرضية');
  says(161, 'الإعفاء', 'إعفاء العامل');
  says(162, 'يومًا كاملاً', 'ثمانى ساعات');
  says(163, 'أجره عن هذه المهلة');
  says(164, 'الجزء الباقى');
  says(165, 'أجر شهرين عن كل سنة', 'لا يقل');
  says(167, 'عشرة أيام', 'كتابة');
  says(168, 'بغير مبرر مشروع');
  says(154, 'خمس سنوات', 'أجر شهر عن كل سنة');
  says(172, 'نصف شهر', 'السنوات الخمس الأولى', 'أجر شهر', 'آخر أجر');
  says(108, 'سبعة أيام');
  says(1, 'الأجر المتغير');
});

test('every article any result cites exists, and has a page to link to', () => {
  const results = [
    leave(person({ monthlyWage: 1 })),
    overtime({ monthlyWage: 1 }),
    notice({ contract: 'open', by: 'employer' }),
    notice({ contract: 'open', by: 'worker' }),
    notice({ contract: 'fixed', by: 'worker' }),
    ...['unlawful', 'fixedOverFive', 'afterSixty', 'resigned'].map((how) => ending({ how, years: 1, monthlyWage: 1 })),
  ];
  for (const result of results) {
    assert.ok(result.articles.length > 0);
    assert.ok(result.notes.length > 0);
    for (const n of result.articles) assert.ok(article(n), `article ${n}`);
  }
});

test('amounts are read as people type them', () => {
  assert.equal(readAmount('6000'), 6_000);
  assert.equal(readAmount('٦٠٠٠'), 6_000);
  assert.equal(readAmount('۶۰۰۰'), 6_000);
  assert.equal(readAmount('10,000'), 10_000);
  assert.equal(readAmount('١٠٬٠٠٠'), 10_000);
  assert.equal(readAmount('1,250,000'), 1_250_000);
  assert.equal(readAmount('٢٥٠٠٫٥'), 2_500.5);
  assert.equal(readAmount('2500,5'), 2_500.5);
  assert.equal(readAmount('6000 جنيه'), 6_000);
  assert.equal(readAmount(' 0 '), 0);
  for (const junk of ['', '  ', 'abc', '-5', '1.2.3', '12 ساعة', '1e9', '99999999999']) assert.equal(readAmount(junk), null, junk);
});

test('every result carries the line, its articles, and a link from the chat', () => {
  const page = read('../src/app/rights/calculators.tsx');
  assert.match(page, /\{DISCLAIMER\}/);
  assert.match(page, /href=\{`\/law\/\$\{article\}`\}/);
  assert.match(page, /\{cited\.notes\.map/);
  const chat = read('../src/components/chat/ask.tsx');
  assert.equal(chat.match(/href="\/rights"/g).length, 2, 'beside the first questions, and always at the foot');
  assert.ok(!page.includes('fetch('), 'a salary typed here goes nowhere');
  assert.ok(!page.includes('postAsHuman'));
});
