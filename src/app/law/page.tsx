import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'المصدر وإخلاء المسؤولية — جيسي',
  description: 'من فين جايه إجابات جيسي، وإيه حدودها.',
};

/*
 * Decision 3 of his sheet: the disclaimer is BOTH a line under every answer and
 * a page of its own. This is the page. It names every source the knowledge base
 * was written from, so a reader can check any figure against the text itself.
 *
 * It is the page someone opens when they are about to rely on a number, so it is
 * set for reading rather than for scanning: a wider measure, more leading, and
 * the disclaimer itself carried on a gold edge instead of a grey box, because it
 * is the one thing on the page that must not be skimmed past.
 */

const SOURCES = [
  ['قانون العمل', 'القانون رقم 14 لسنة 2025 — الفصل الخامس: الإجازات (المواد 124 إلى 133)، والمواد 54 إلى 57 في شأن المرأة العاملة.'],
  ['العطلات والأعياد', 'قرار وزير العمل رقم 294 لسنة 2025 — تحديد 12 مناسبة تُعتبر إجازة بأجر كامل.'],
  ['الأعمال الخطرة', 'قرار وزير العمل رقم 49 لسنة 2026 — الأعمال الخطرة والصعبة والمناطق النائية التي تستحق زيادة 7 أيام.'],
  ['التعويض عن الأجر في المرض', 'قانون التأمينات الاجتماعية والمعاشات رقم 148 لسنة 2019 — وهو اللي بيحدد نسبة ومدة التعويض في الحالة العامة.'],
  ['سن الطفل في رعاية الطفل', 'قانون الطفل رقم 12 لسنة 1996، المادة 72 فقرة ثانية — المادة 57 من قانون العمل بتحيل عليها.'],
];

export default function Law() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-20 pt-10 sm:pt-14">
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 rounded-lg text-sm opacity-70 transition hover:opacity-100"
      >
        {/* The arrow points right, towards the start of an Arabic line, and steps that way on
            hover. A left-pointing "back" arrow on an RTL page points at the end of the sentence. */}
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">←</span>
        <span className="underline decoration-ink/25 underline-offset-4 transition group-hover:decoration-gold">
          رجوع لجيسي
        </span>
      </Link>

      <h1 className="balance mt-7 text-[1.75rem] font-bold leading-tight tracking-tight sm:text-3xl">
        المصدر وإخلاء المسؤولية
      </h1>
      <span aria-hidden className="mt-3 block h-[2px] w-12 rounded-full bg-gold/70" />

      <section className="mt-7 space-y-5 text-[0.95rem] leading-8">
        <p className="opacity-90">
          جيسي بتعرض نصوص قانون العمل المصري وقراراته التنفيذية زي ما هي، وبتذكر رقم المادة مع كل إجابة
          عشان تقدر ترجع للنص بنفسك.
        </p>

        {/* The one thing on this page that must not be skimmed: it gets the gold edge on the
            reading side, and sits a step above the page rather than inside a grey box. */}
        <p className="surface rounded-2xl border-s-[3px] border-s-gold p-5">
          <strong className="font-bold">ده مش استشارة قانونية.</strong> الحالات الفردية بتختلف حسب عقدك
          ولائحة شركتك ومدة خدمتك، وفيه تفاصيل بتتحدد باللائحة التنفيذية وبقرارات الوزير. لو الموضوع فيه
          نزاع أو قرار مهم، ارجع للشؤون القانونية في شركتك، أو لمكتب العمل التابع ليه، أو لمحامي.
        </p>

        <p className="opacity-90">لو السؤال مش من باب الإجازات، جيسي بتقول إنها ما تعرفش بدل ما تخمّن — وده مقصود.</p>
      </section>

      <h2 className="mt-12 text-lg font-bold">المصادر</h2>
      <span aria-hidden className="mt-2.5 block h-px w-8 rounded-full bg-gold/60" />

      <dl className="mt-5 space-y-3">
        {SOURCES.map(([name, detail]) => (
          <div key={name} className="surface rounded-2xl p-5 transition hover:border-ink/20">
            <dt className="font-semibold">{name}</dt>
            <dd className="answer mt-1.5 text-sm opacity-80">{detail}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-10 text-center text-xs opacity-55">
        كل رقم في الإجابات مكتوب في المصادر دي، ومع كل إجابة رقم المادة اللي جه منها.
      </p>
    </main>
  );
}
