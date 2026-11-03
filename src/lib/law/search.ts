/*
 * How Jessy finds the law for a question.
 *
 * The law is written in formal Arabic and the question arrives in Cairo: "اترفدت"
 * has to reach an article that says "إنهاء الخدمة", "الاوفر تايم" one that says
 * "التشغيل الإضافي". So the question is normalised, stripped down to stems, widened
 * through WORDS (what people say to what the law says), and scored against every
 * record with BM25, and that list is joined with one ordered by meaning. A number
 * the person names ("المادة 124") is simply fetched.
 *
 * This file imports nothing and holds no data, so node runs it directly in tests/,
 * and the exam in tests/law-exam.json measures it on questions it has never seen.
 */

export type LawRecord = {
  id: string;
  kind: 'law' | 'issuing' | 'decree' | 'practice';
  n?: number;
  label?: string;
  decree?: number;
  year?: number;
  under?: number;
  book?: string;
  part?: string;
  chapter?: string;
  text: string;
};

/** `score` is the word match alone, which says how much of the question the text really shares. */
export type Hit = { record: LawRecord; score: number };

/** What each record means, as numbers, in the order of the records. Built by tools/build-law-vectors.mjs. */
export type LawVectors = { model: string; dims: number; ids: string[]; data: string };

/** One spelling for every way Arabic is typed: no vowel marks, one alef, one yeh, one teh marbuta. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه');
}

const STOP = new Set(
  normalise(
    'في من على عن الى إلى او أو و ثم هل ما ماذا لو اذا إذا ان أن إن لا لم لن قد كل هذا هذه ذلك تلك التي الذي الذين ' +
      'اللي ده دي دول انا أنا انت إنت احنا هو هي هم ليا ليك ليه ايه إيه ازاي إزاي كام امتى فين مين عايز عاوز ' +
      'عايزه محتاج ينفع يعني بس كده برضو طب طيب مع عند بعد قبل به بها له لها كان كانت يكون تكون ولا غير',
  ).split(/\s+/),
);

/** A word down to what it shares with its family. Conservative: three letters always survive. */
export function stem(word: string): string {
  let w = word;
  for (const pre of ['وبال', 'وال', 'بال', 'فال', 'كال', 'لل', 'ال']) {
    if (w.startsWith(pre) && w.length - pre.length >= 3) {
      w = w.slice(pre.length);
      break;
    }
  }
  if (w.length >= 5 && /^[وفبل]/.test(w)) w = w.slice(1);
  for (const suf of ['اتها', 'اته', 'ات', 'يتها', 'يته', 'تها', 'تهم', 'ونها', 'ون', 'ين', 'ها', 'هم', 'كم', 'ني', 'يه', 'ه', 'ي', 'ك']) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

/** Plurals Arabic makes by changing the word, which no suffix rule reaches: "أشهر" and "شهور" are "شهر". */
const SAME_WORD: Record<string, string> = Object.fromEntries(
  (
    'شهر:شهور,اشهر,شهرين,شهران;يوم:ايام,يومين,يومان;سن:سنه,سنين,سنوات,سنتين,سنتان,عام,اعوام,عامين;' +
    'ساع:ساعات,ساعتين;اسبوع:اسابيع,اسبوعين;عمل:شغل,شغلي,الشغل,شغلك;عامل:عمال,موظف,موظفين,موظفه,عامله,عاملات;' +
    'اجر:اجور,مرتب,مرتبات,راتب,مرتبي;اجاز:اجازه,اجازات,اجازتي,اجازتك,الاجازات'
  )
    .split(';')
    .flatMap((group) => {
      const [to, from] = group.split(':');
      return from.split(',').map((word) => [word, to] as const);
    }),
);

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of normalise(text).match(/[a-z]+|[ء-ي]+|\d+/g) ?? []) {
    if (STOP.has(raw) || raw.length < 2) continue;
    const bare = raw.replace(/^(?:وال|بال|فال|لل|ال|و|ف|ب)(?=[ء-ي]{2})/, '');
    out.push(SAME_WORD[raw] ?? SAME_WORD[bare] ?? stem(raw));
  }
  return out;
}

/*
 * Subjects whose answer is known to live in particular articles, whichever words the question
 * happens to use. BM25 alone sends "اشتغلت 7 شهور، ليا إجازة؟" to every article with "إجازة" in
 * it and misses the one that answers, because the word is too common to count. A seed lifts its
 * articles into what she reads; it is not an answer, and the words still order everything else.
 */
const SEEDS: [RegExp, number[]][] = [
  [/اجاز.*(سنو|اعتياد|رصيد|شهور|شهر|سنه|سنين|كام|جديد|تعيين|مديري|رافض|رفض|مخدتهاش|فلوس|مقابل)|annual|vacation|رصيد/, [124, 125]],
  [/عارض|طارئ|ظرف/, [128]],
  [/امتحان|دراس|كليه|جامع/, [126]],
  [/مرض|عيان|تعبان|عمليه|مستشف/, [131, 173]],
  [/حامل|وضع|ولاده|ولدت|رضاع/, [54, 55, 56]],
  [/رعايه طفل|حضان/, [57]],
  [/حج|عمره/, [130]],
  [/عيد|عطله|عطلات|اعياد|مناسب/, [129]],
  [/اوفر|overtime|اضافي|زياده عن المواعيد|ساعات زياده/, [121]],
  [/ساعات (الشغل|العمل)|working hours|كام ساعه/, [117, 118, 119]],
  [/رفد|طرد|فصل|fired|dismiss|مشوني/, [165, 170, 169]],
  [/استقال|استقيل|resign/, [167, 168]],
  [/غبت|غياب|انقطع|اتغيب/, [166]],
  [/خصم|جزاء|لائحه/, [143]],
  [/محدد المده|تجديد|عقد سنه|عقد مؤقت/, [88, 154]],
  [/اختبار|بروبيشن|probation|تجربه/, [91]],
  [/نهايه الخدمه|مكافا/, [172]],
  [/من غير عقد|بدون عقد|مفيش عقد|ماضيتش عقد|مضيتش علي عقد|مش موظف عندي/, [88, 89]],
  [/(^| )(باع|اتباع)|بيع|اندماج|دمج/, [11]],
  [/الكهربا|عطل|(المصنع|الشغل) واقف|وقف الشغل|توقف/, [111]],
  [/الليل.*(بيبدا|بيتحسب|امتي)|(بيبدا|بيتحسب|امتي).*الليل|تعريف|يعني ايه/, [1]],
  [/تحقيق|تحقبق|قرار جزا|توقيع (ال)?جزا/, [138, 139, 140, 141]],
  [/مخالصه|اتنازلت|تنازل/, [6]],
  [/افلاس|بتفلس|فلست|تصفيه|ديون/, [8]],
  [/remote|ريموت|من البيت|عن بعد|فري لانس|freelance/, [97, 99]],
  [/خوذ|جوانتي|مهمات|سلامه|وقايه/, [267]],
];
const SEED_BONUS = 4.5;

function seededArticles(question: string): Set<number> {
  const text = normalise(question);
  const out = new Set<number>();
  for (const [re, articles] of SEEDS) if (re.test(text)) for (const a of articles) out.add(a);
  return out;
}

/*
 * What people say, and what the law says for it. Each key is matched inside the normalised
 * question, so one spelling covers "اترفدت", "اترفد" and "هيترفد". Added words count for less
 * than the person's own (see WIDENED), so a wide entry cannot drown what was actually asked.
 */
const WORDS: [string, string][] = [
  // Ending the job
  ['رفد', 'فصل إنهاء عقد العمل العامل تعويض'],
  ['طرد', 'فصل إنهاء عقد العمل العامل تعويض'],
  ['مشوني', 'فصل إنهاء عقد العمل تعويض'],
  ['فصلوني', 'فصل إنهاء عقد العمل تعويض'],
  ['فصل', 'فصل إنهاء الخطأ الجسيم المحكمة العمالية'],
  ['fired', 'فصل إنهاء عقد العمل تعويض'],
  ['dismiss', 'فصل إنهاء عقد العمل تعويض'],
  ['terminat', 'إنهاء عقد العمل فصل تعويض'],
  ['سيبت الشغل', 'انتهاء علاقة العمل استقالة مقابل رصيد'],
  ['استقيل', 'استقالة الجهة الإدارية قبول العدول'],
  ['استقال', 'استقالة الجهة الإدارية قبول العدول'],
  ['resign', 'استقالة الجهة الإدارية قبول العدول'],
  ['نوتيس', 'إخطار إنهاء مهلة'],
  ['notice', 'إخطار إنهاء مهلة'],
  ['مهله', 'إخطار إنهاء مهلة'],
  ['اخطار', 'إخطار إنهاء مهلة'],
  ['مكافاه', 'مكافأة نهاية الخدمة'],
  ['نهايه الخدمه', 'مكافأة انتهاء الخدمة شهادة'],
  ['شهاده خبره', 'شهادة نهاية خدمة تسليم أوراق'],
  ['شهاده خدمه', 'شهادة نهاية خدمة تسليم أوراق'],
  ['ورقي', 'تسليم أوراق شهادة العامل'],
  ['معاش', 'بلوغ سن الستين التقاعد'],
  ['الستين', 'بلوغ سن الستين'],
  ['مات', 'وفاة العامل'],
  ['توفي', 'وفاة العامل'],
  ['وفاه', 'وفاة العامل'],
  // Pay
  ['مرتب', 'أجر'],
  ['راتب', 'أجر'],
  ['قبض', 'أجر أداء الأجر'],
  ['salary', 'أجر'],
  ['pay', 'أجر'],
  ['خصم', 'خصم أجر جزاء اقتطاع'],
  ['خصمو', 'خصم أجر جزاء اقتطاع'],
  ['سلف', 'أقرض قرض اقتطاع'],
  ['قرض', 'أقرض قرض اقتطاع'],
  ['علاوه', 'علاوة دورية أجر'],
  ['حد الادني', 'الحد الأدنى للأجور المجلس القومي'],
  ['بونص', 'أجر حافز عمولة'],
  // Hours
  ['اوفر', 'التشغيل الإضافي ساعات الإضافية أجر'],
  ['overtime', 'التشغيل الإضافي ساعات الإضافية أجر'],
  ['ساعات زياده', 'التشغيل الإضافي ساعات الإضافية أجر'],
  ['ساعات الشغل', 'ساعات العمل الفعلية'],
  ['ساعات العمل', 'ساعات العمل الفعلية'],
  ['working hours', 'ساعات العمل الفعلية'],
  ['بريك', 'فترة الراحة الطعام'],
  ['راحه', 'فترة الراحة الأسبوعية'],
  ['يوم الجمعه', 'الراحة الأسبوعية'],
  ['الاجازه الاسبوعيه', 'الراحة الأسبوعية'],
  ['بالليل', 'ليلية ساعة العمل الليلية'],
  ['شيفت', 'ساعات العمل ليلية'],
  // Discipline
  ['غبت', 'غياب تغيب إنذار مستقيل'],
  ['غياب', 'غياب تغيب إنذار مستقيل'],
  ['انقطع', 'غياب تغيب إنذار مستقيل'],
  ['اتاخر', 'تأخير جزاء لائحة'],
  ['تاخير', 'تأخير جزاء لائحة'],
  ['جزاء', 'جزاء تأديبي لائحة تحقيق'],
  ['تحقيق', 'تحقيق جزاء تأديبي'],
  ['انذار', 'إنذار جزاء'],
  ['جواب', 'إنذار خطاب موصى عليه'],
  ['وقف', 'وقف العامل عن عمله'],
  ['وقفوني', 'وقف العامل عن عمله'],
  ['لائحه', 'لائحة تنظيم العمل الجزاءات'],
  ['تحرش', 'تحرش تنمر عنف'],
  ['تنمر', 'تحرش تنمر عنف'],
  ['مخدرات', 'تعاطي مخدرات مسكرات'],
  // The contract
  ['عقد', 'عقد العمل'],
  ['contract', 'عقد العمل'],
  ['كونتراكت', 'عقد العمل'],
  ['محدد المده', 'عقد محدد المدة تجديد'],
  ['تجديد', 'تجديد عقد محدد المدة'],
  ['بروبيشن', 'فترة الاختبار'],
  ['probation', 'فترة الاختبار'],
  ['تحت الاختبار', 'فترة الاختبار'],
  ['فتره اختبار', 'فترة الاختبار'],
  ['تحت التجربه', 'فترة الاختبار'],
  ['نقلوني', 'نقل العامل مكان وظيفة'],
  ['غيرو', 'تغيير وظيفة نقل'],
  ['ريموت', 'العمل عن بعد أنماط العمل الجديدة'],
  ['remote', 'العمل عن بعد أنماط العمل الجديدة'],
  ['من البيت', 'العمل عن بعد أنماط العمل الجديدة'],
  ['اونلاين', 'العمل عن بعد أنماط العمل الجديدة'],
  ['بارت', 'بعض الوقت أنماط العمل الجديدة'],
  ['part time', 'بعض الوقت أنماط العمل الجديدة'],
  ['فريلانس', 'العمل المستقل الحر أنماط'],
  ['يوميه', 'أجر يومي العمالة غير المنتظمة'],
  // Leave
  ['اجازه', 'إجازة'],
  ['اجازات', 'إجازة'],
  ['leave', 'إجازة'],
  ['vacation', 'إجازة'],
  ['annual', 'إجازة سنوية'],
  ['sick', 'إجازة مرضية'],
  ['maternity', 'إجازة الوضع'],
  ['اعتيادي', 'إجازة سنوية'],
  ['رصيد', 'رصيد الإجازات تسوية الأجر المقابل'],
  ['مرض', 'إجازة مرضية الجهة الطبية'],
  ['تعبان', 'إجازة مرضية الجهة الطبية'],
  ['عيان', 'إجازة مرضية الجهة الطبية'],
  ['حامل', 'إجازة الوضع العاملة الحمل'],
  ['ولاده', 'إجازة الوضع'],
  ['ولدت', 'إجازة الوضع مولود'],
  ['رضاعه', 'فترتين للرضاعة الطفل'],
  ['ابني', 'رعاية طفل'],
  ['بنتي', 'رعاية طفل'],
  ['جيش', 'تجنيد الخدمة العسكرية'],
  ['تجنيد', 'تجنيد الخدمة العسكرية'],
  // Who
  ['ستات', 'تشغيل النساء العاملة'],
  ['سيدات', 'تشغيل النساء العاملة'],
  ['بنات', 'تشغيل النساء العاملة'],
  ['اطفال', 'تشغيل الأطفال الطفل'],
  ['اجنبي', 'الأجانب ترخيص عمل'],
  ['اجانب', 'الأجانب ترخيص عمل'],
  ['معاق', 'الأشخاص ذوي الإعاقة'],
  ['ذوي الهمم', 'الأشخاص ذوي الإعاقة'],
  ['اعاقه', 'الأشخاص ذوي الإعاقة'],
  ['خدامه', 'الخدمة المنزلية'],
  ['منزلي', 'الخدمة المنزلية'],
  ['حكومه', 'أجهزة الدولة وحدات الإدارة المحلية'],
  // Where to go
  ['مكتب العمل', 'الجهة الإدارية المختصة شكوى'],
  ['اشتكي', 'شكوى الجهة الإدارية المختصة لجنة تسوية'],
  ['شكوي', 'شكوى الجهة الإدارية المختصة لجنة تسوية'],
  ['محكمه', 'المحكمة العمالية دعوى'],
  ['قضيه', 'المحكمة العمالية دعوى'],
  ['اترفع', 'المحكمة العمالية دعوى'],
  ['ارفع', 'المحكمة العمالية دعوى'],
  ['تقادم', 'تسقط الدعوى بالتقادم'],
  ['اضراب', 'الإضراب إغلاق'],
  ['نقابه', 'المنظمات النقابية'],
  ['اصابه', 'إصابة العمل'],
  ['سلامه', 'السلامة والصحة المهنية'],
  ['تفتيش', 'تفتيش العمل مفتش'],
  ['تامين', 'التأمينات الاجتماعية'],
];

const BM25_K = 1.4;
const BM25_B = 0.72;
/** A word the person typed counts in full; one WORDS added for them, less. */
const WIDENED = 0.55;
/** A word in a chapter's heading says what the whole chapter is about. */
const HEADING_WEIGHT = 1.5;
/** Law before a decree under it, when both say the same thing. */
const DECREE_DISCOUNT = 0.82;

export type LawIndex = {
  records: LawRecord[];
  terms: Map<string, number>[];
  lengths: number[];
  average: number;
  df: Map<string, number>;
  byArticle: Map<number, LawRecord>;
  meaning?: { dims: number; bytes: Int8Array };
};

/** One row of the vectors per record, or nothing if they were built from a different law. */
function readVectors(records: LawRecord[], vectors?: LawVectors): LawIndex['meaning'] {
  if (!vectors || vectors.ids.length !== records.length) return undefined;
  if (vectors.ids.some((id, i) => id !== records[i].id)) return undefined;
  const binary = atob(vectors.data);
  const bytes = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { dims: vectors.dims, bytes };
}

export function buildIndex(records: LawRecord[], vectors?: LawVectors): LawIndex {
  const terms: Map<string, number>[] = [];
  const lengths: number[] = [];
  const df = new Map<string, number>();
  const byArticle = new Map<number, LawRecord>();
  for (const record of records) {
    const map = new Map<string, number>();
    const body = tokens(record.text);
    for (const t of body) map.set(t, (map.get(t) ?? 0) + 1);
    for (const t of tokens(`${record.chapter ?? ''} ${record.part ?? ''}`)) {
      map.set(t, (map.get(t) ?? 0) + HEADING_WEIGHT);
    }
    terms.push(map);
    lengths.push(body.length);
    for (const t of map.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    if (record.kind === 'law' && record.n) byArticle.set(record.n, record);
  }
  const average = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  return { records, terms, lengths, average, df, byArticle, meaning: readVectors(records, vectors) };
}

/** The articles the person named outright: "المادة 124", "ماده ١٢٤", "م 124". */
export function namedArticles(question: string): number[] {
  const text = normalise(question);
  const found = [...text.matchAll(/(?:ماده|الماده|مواد|المواد|م\.?)\s*\(?\s*(\d{1,3})/g)].map((m) => Number(m[1]));
  return [...new Set(found)].filter((n) => n >= 1 && n <= 298);
}

/** The question's words with their weights: its own in full, what WORDS adds for them less. */
export function weightedTerms(question: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const t of tokens(question)) weights.set(t, 1);
  const text = normalise(question);
  for (const [said, law] of WORDS) {
    if (!text.includes(normalise(said))) continue;
    for (const t of tokens(law)) if (!weights.has(t)) weights.set(t, WIDENED);
  }
  return weights;
}

/** How far down a list a rank still counts; the usual constant for joining ranked lists. */
const FUSION = 60;
/** Only this many from the meaning side: past it, the closest record is no longer close. */
const MEANING_TOP = 30;

/** Records in order of closeness to the question's meaning. */
function byMeaning(index: LawIndex, question: number[]): number[] {
  const { dims, bytes } = index.meaning!;
  const scored = index.records.map((_, i) => {
    let dot = 0;
    for (let j = 0; j < dims; j++) dot += bytes[i * dims + j] * (question[j] ?? 0);
    return { i, dot };
  });
  return scored.sort((a, b) => b.dot - a.dot).slice(0, MEANING_TOP).map((s) => s.i);
}

/**
 * The law for a question. Words find what is said the way the law says it, and a named article
 * outright; meaning (`questionVector`, when the embedding call worked) finds what is said in
 * other words entirely, or in another language. Each list votes by rank, so neither scale has to
 * be compared with the other, and without a vector the words alone still answer.
 */
export function search(index: LawIndex, question: string, limit = 8, questionVector?: number[] | null): Hit[] {
  const weights = weightedTerms(question);
  const seeded = seededArticles(question);
  const n = index.records.length;
  const hits: Hit[] = [];
  index.records.forEach((record, i) => {
    let score = 0;
    const doc = index.terms[i];
    const norm = BM25_K * (1 - BM25_B + (BM25_B * index.lengths[i]) / index.average);
    for (const [term, weight] of weights) {
      const tf = doc.get(term);
      if (!tf) continue;
      const df = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += weight * idf * ((tf * (BM25_K + 1)) / (tf + norm));
    }
    if (record.kind === 'decree' || record.kind === 'practice') score *= DECREE_DISCOUNT;
    if (record.n && seeded.has(record.n)) score += SEED_BONUS;
    if (score > 0) hits.push({ record, score });
  });
  hits.sort((a, b) => b.score - a.score);

  if (questionVector && index.meaning) {
    const votes = new Map<LawRecord, number>();
    hits.forEach((hit, rank) => votes.set(hit.record, 1 / (FUSION + rank)));
    const scoreOf = new Map(hits.map((hit) => [hit.record, hit.score]));
    byMeaning(index, questionVector).forEach((i, rank) => {
      const record = index.records[i];
      votes.set(record, (votes.get(record) ?? 0) + 1 / (FUSION + rank));
      if (!scoreOf.has(record)) hits.push({ record, score: 0 });
    });
    // A subject's own articles vote as a third list: a bonus on the word score alone is lost here.
    [...seeded].forEach((article, rank) => {
      const record = index.byArticle.get(article);
      if (!record) return;
      votes.set(record, (votes.get(record) ?? 0) + 1 / (FUSION + rank));
      if (!scoreOf.has(record) && !hits.some((h) => h.record === record)) hits.push({ record, score: 0 });
    });
    hits.sort((a, b) => (votes.get(b.record) ?? 0) - (votes.get(a.record) ?? 0));
  }

  const named = namedArticles(question)
    .map((a) => index.byArticle.get(a))
    .filter((r): r is LawRecord => !!r)
    .map((record) => ({ record, score: Number.MAX_SAFE_INTEGER }));
  const seen = new Set(named.map((h) => h.record.id));
  const ordered = [...named, ...hits.filter((h) => !seen.has(h.record.id))];
  // A practice note may come along if it ranks with the law, but only one, and never in the law's place.
  const practice = ordered.slice(0, limit).find((h) => h.record.kind === 'practice');
  const law = ordered.filter((h) => h.record.kind !== 'practice').slice(0, limit);
  return practice ? [...law, practice] : law;
}

/** The name a record is cited by. */
export function citeName(record: LawRecord): string {
  if (record.kind === 'law') return `مادة ${record.n}`;
  if (record.kind === 'decree') return `قرار وزير العمل ${record.decree} لسنة ${record.year}`;
  if (record.kind === 'practice') return `ملاحظة عملية، مش نص قانون: ${record.label ?? ''}`;
  return `قانون الإصدار، المادة ${record.label ?? ''}`.trim();
}
