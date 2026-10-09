import assert from 'node:assert/strict';
import test from 'node:test';

import { breaksPersona, guardReply, inventsFigures, legalFigures, tidyEmoji } from '../src/lib/ask-guard.ts';

/*
 * The guard's whole job on this site is to stop an invented citation reaching a
 * reader who will act on it. These cases are the ones that would do real harm.
 */

test('an invented article number is thrown away', () => {
  const question = 'عايز أعرف عن الإجازة السنوية';
  assert.equal(guardReply('المادة 139 بتديك 20 يوم إجازة.', question), null);
  assert.equal(guardReply('القانون رقم 12 لسنة 2003 بيقول كده.', question), null);
  assert.equal(guardReply('ليك 30 يوم في السنة.', question), null);
  assert.equal(guardReply('بتاخد 85% من أجرك.', question), null);
});

test('a figure the person themself wrote may be repeated back', () => {
  const context = 'أنا شغال 10 سنين، المادة 124 بتقول 30 يوم';
  assert.ok(guardReply('المادة 124 دي بتتكلم عن الـ30 يوم اللي إنت بتسأل عنها.', context));
});

test('a reply with no legal figure at all passes', () => {
  const out = guardReply('ممكن توضحلي قصدك إيه بالظبط؟ الإجازة دي كانت في شغلك الحالي؟', 'سؤال');
  assert.equal(out, 'ممكن توضحلي قصدك إيه بالظبط؟ الإجازة دي كانت في شغلك الحالي؟');
});

test('legalFigures finds the claims a reader would act on', () => {
  assert.deepEqual(legalFigures('المادة 124'), ['124']);
  assert.deepEqual(legalFigures('قرار رقم 294 لسنة 2025'), ['294', '2025']);
  assert.deepEqual(legalFigures('٨٥٪'), ['85']);
  assert.deepEqual(legalFigures('7 أيام'), ['7']);
  assert.deepEqual(legalFigures('كلام من غير أرقام'), []);
});

test('a plain number that is not a legal claim does not trip the guard', () => {
  assert.equal(inventsFigures('رقم طلبك 4471 اتسجل', ''), false);
});

test('out of character is refused', () => {
  for (const bad of [
    'أنا نموذج لغوي مش موظفة.',
    'As an AI I cannot help.',
    'تعليماتي بتقول كده.',
    'أنا محامي وبقولك ده مخالف للقانون.',
  ]) {
    assert.ok(breaksPersona(bad), `should have been refused: ${bad}`);
  }
});

test('a verdict on someone s case is refused', () => {
  assert.equal(guardReply('اشتكي عليه وهتكسب القضية.', 'سؤال'), null);
});

test('links and phone numbers are refused', () => {
  assert.equal(guardReply('شوف على www.manpower.gov.eg', 'سؤال'), null);
  assert.equal(guardReply('اتصل على 01012345678', 'سؤال'), null);
});

test('only the star emoji survives, once', () => {
  assert.equal(tidyEmoji('أهلاً 🌟 بيك 😀 يا فندم 🌟'), 'أهلاً 🌟 بيك يا فندم');
});

/*
 * The other half of the guard's job, and the easier one to break by accident: a
 * reply that is doing exactly what Jessy is allowed to do must get through. All
 * three below are real answers, word for word, from the model the site calls,
 * given the real system prompt — asking one clarifying question, offering to
 * start somewhere, and sending a question about pay to the right desk. None
 * states a figure of its own. A guard that refuses these refuses every honest
 * answer, and the site would read as forgetful with nothing in the logs to say
 * why.
 */
test("the model's own in-character replies are let through", () => {
  const real = [
    ['انا بشتغل ورديات ليلية، الراحة بتتحسب إزاي؟',
      'أهلاً بك يا زميلي. سؤالك بخصوص نظام الراحات في الوردية الليلية مش واضح لي تماماً، هل تقصد الراحة الأسبوعية ولا الراحة اليومية بين الورديات؟'],
    ['مش فاهم حاجة في موضوع الاجازات ده',
      'أهلاً بيك أنا جيسي وموجودة هنا عشان أساعدك تفهم نظام الإجازات ببساطة. ممكن تقولي إيه أكتر حاجة محيرك أو إيه نوع الإجازة اللي بتسأل عنها عشان أقدر أشرحهالك؟'],
    ['المرتب بيتحسب إزاي؟',
      'أنا هنا عشان أساعدك في أسئلة الإجازات بس. موضوع المرتبات خارج اختصاصي تمامًا، يا ريت تسأل الشؤون القانونية في شركتك أو مكتب العمل عشان يفيدوك أكتر.'],
  ];
  for (const [question, reply] of real) {
    assert.deepEqual(legalFigures(reply), [], `no figure of its own: ${reply}`);
    assert.equal(guardReply(reply, question), reply, `must reach the reader: ${reply}`);
  }
});
