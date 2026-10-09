import assert from 'node:assert/strict';
import test from 'node:test';

import { ENTRIES, FALLBACK } from '../src/lib/kb-data.ts';
import { answerFrom, match } from '../src/lib/kb.ts';

/*
 * Every leave question an employee actually asks must reach the entry that
 * carries the right article. A question that reaches the WRONG entry is worse
 * than one that reaches none, because the reader gets a confident wrong figure.
 */

/** [what an employee types, the entry id that must answer] */
const ROUTES = [
  ['أنا مستحق كام يوم إجازة في السنة؟', 'annual'],
  ['الإجازة السنوية كام يوم؟', 'annual'],
  ['لسه جديد في الشركة، آخد إجازة؟', 'annual-first-year'],
  ['أنا شغال في أعمال خطرة، في زيادة؟', 'annual-hazard'],
  ['صاحب العمل رفض إجازتي، أعمل إيه؟', 'annual-rules'],
  ['لو رفضت كتابة آخد الإجازة يحصل إيه؟', 'annual-written-refusal'],
  ['عندي امتحان، في إجازة؟', 'exam'],
  ['مراتي هتولد، ليا إجازة؟', 'newborn-day'],
  ['الإجازة العارضة كام يوم؟', 'casual'],
  ['العطلات الرسمية كام مناسبة؟', 'holidays-list'],
  ['شغلوني في العيد، آخد كام؟', 'work-on-holiday'],
  ['عايز أروح الحج، في إجازة؟', 'hajj'],
  ['أنا شغال في مصنع، المرضي بيتحسب إزاي؟', 'sick-industrial'],
  ['عندي عملية، الإجازة المرضية إيه نظامها؟', 'sick-general'],
  ['أقدر أحول المرضية لسنوية؟', 'sick-to-annual'],
  ['في حد في البيت عنده مرض معدي', 'contact-infectious'],
  ['إجازة الوضع كام شهر؟', 'maternity'],
  ['أنا حامل، ساعات الشغل بتقل؟', 'pregnant-hours'],
  ['رجعت من إجازة الوضع، وظيفتي محفوظة؟', 'return-after-maternity'],
  ['فترة الرضاعة كام؟', 'nursing'],
  ['إجازة رعاية الطفل كام سنة؟', 'childcare'],
  ['في إجازة بدون مرتب في القانون؟', 'unpaid'],
  ['أقدر أشتغل في إجازتي عند حد تاني؟', 'other-work'],
  ['انتي مين؟', 'who'],
  ['السلام عليكم', 'greeting'],
  ['شكرا', 'thanks'],
  ['كلامك ده استشارة قانونية؟', 'disclaimer'],
];

test('every question reaches the entry that holds its article', () => {
  for (const [question, id] of ROUTES) {
    const hit = match(ENTRIES, question);
    assert.ok(hit, `no entry answered: ${question}`);
    assert.equal(hit.id, id, `"${question}" went to ${hit.id}, expected ${id}`);
  }
});

test('a question outside the leave chapter falls through, it is not guessed at', () => {
  for (const question of [
    'مرتبي اتأخر، أعمل إيه؟',
    'عايز أعرف قانون الضرائب',
    'إزاي أستقيل؟',
    'ما هو سعر الدولار',
  ]) {
    assert.equal(match(ENTRIES, question), null, `"${question}" should not have been answered`);
  }
});

test('the fallback says it does not know, it does not invent', () => {
  const out = answerFrom(ENTRIES, FALLBACK, 'ما هو سعر الدولار', 'ar');
  assert.equal(out.kind, 'fallback');
  assert.match(out.text, /مش لاقياها/);
});

test('every entry names its article, so a reader can check it', () => {
  const EXEMPT = new Set(['who', 'greeting', 'thanks', 'disclaimer']);
  for (const entry of ENTRIES) {
    if (EXEMPT.has(entry.id)) continue;
    assert.match(
      entry.answer.ar,
      /المادة \d+|قرار وزير العمل (رقم )?\d+|القانون \d+|قانون العمل \d+/,
      `entry ${entry.id} cites no article`,
    );
  }
});

test('the figures the handed-over document got wrong are right here', () => {
  const byId = Object.fromEntries(ENTRIES.map((e) => [e.id, e.answer.ar]));
  // The docx said 95%; the law says 85% then 75%, and only in industrial establishments.
  assert.match(byId['sick-industrial'], /85%/);
  assert.match(byId['sick-industrial'], /75%/);
  assert.doesNotMatch(byId['sick-industrial'], /95%/);
  // The docx said casual leave lasts "7 سنوات".
  assert.match(byId['casual'], /7 أيام/);
  assert.doesNotMatch(byId['casual'], /سنوات/);
  // Child care is two years, and it is the only unpaid leave in the law.
  assert.match(byId['childcare'], /سنتين/);
  assert.match(byId['unpaid'], /المادة 57/);
  // Twelve occasions, not fifteen dates.
  assert.match(byId['holidays-list'], /12 مناسبة/);
  // Article 132 bars the worker from working; it is not a nursing leave.
  assert.match(byId['contact-infectious'], /تمنعك من مزاولة شغلك/);
});

test('ids are unique', () => {
  const ids = ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});
