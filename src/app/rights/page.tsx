import Link from 'next/link';
import type { Metadata } from 'next';

import { Calculators } from './calculators';

export const metadata: Metadata = {
  title: 'احسب حقوقك — جيسي',
  description: 'رصيد الإجازة، الأوفر تايم، مهلة الإخطار، ومستحقات نهاية الخدمة حسب قانون العمل المصري 14 لسنة 2025.',
};

/*
 * The four sums people ask her for most. Each result links the articles it stands on and carries
 * the same line every answer does. The figures are worked out on the person's own device
 * (lib/law/rights.ts), so a salary typed here goes nowhere.
 */

export default function Rights() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-20 pt-10 sm:pt-14">
      <Link
        href="/"
        className="group inline-flex items-center gap-1.5 rounded-lg text-sm opacity-70 transition hover:opacity-100"
      >
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">←</span>
        <span className="underline decoration-ink/25 underline-offset-4 transition group-hover:decoration-gold">
          رجوع لجيسي
        </span>
      </Link>

      <h1 className="balance mt-7 text-[1.75rem] font-bold leading-tight tracking-tight sm:text-3xl">احسب حقوقك</h1>
      <span aria-hidden className="mt-3 block h-[2px] w-12 rounded-full bg-gold/70" />

      <p className="answer mt-6 text-[0.95rem] opacity-90">
        الأرقام هنا تقدير من نص قانون العمل 14 لسنة&nbsp;2025، ومع كل نتيجة المواد اللي مبنية عليها. الحساب بيحصل على جهازك،
        ومفيش رقم بتكتبه بيوصلنا.
      </p>

      <Calculators />
    </main>
  );
}
