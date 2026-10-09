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
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <Link href="/" className="text-sm underline opacity-70">
        رجوع لجيسي
      </Link>

      <h1 className="mt-6 text-2xl font-bold">المصدر وإخلاء المسؤولية</h1>

      <section className="mt-6 space-y-4 text-sm leading-8">
        <p>
          جيسي بتعرض نصوص قانون العمل المصري وقراراته التنفيذية زي ما هي، وبتذكر رقم المادة مع كل إجابة
          عشان تقدر ترجع للنص بنفسك.
        </p>
        <p className="rounded-xl border border-black/10 bg-white p-4">
          <strong>ده مش استشارة قانونية.</strong> الحالات الفردية بتختلف حسب عقدك ولائحة شركتك ومدة خدمتك،
          وفيه تفاصيل بتتحدد باللائحة التنفيذية وبقرارات الوزير. لو الموضوع فيه نزاع أو قرار مهم، ارجع
          للشؤون القانونية في شركتك، أو لمكتب العمل التابع ليه، أو لمحامي.
        </p>
        <p>
          لو السؤال مش من باب الإجازات، جيسي بتقول إنها ما تعرفش بدل ما تخمّن — وده مقصود.
        </p>
      </section>

      <h2 className="mt-10 text-lg font-bold">المصادر</h2>
      <dl className="mt-4 space-y-4 text-sm leading-7">
        {SOURCES.map(([name, detail]) => (
          <div key={name} className="rounded-xl border border-black/10 bg-white p-4">
            <dt className="font-semibold">{name}</dt>
            <dd className="mt-1 opacity-80">{detail}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
