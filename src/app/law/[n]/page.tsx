import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { LAW } from '@/lib/law/index';

/*
 * One article of the law, with the decrees printed under it, so an answer's citation can be read
 * in full. The numbers run 1 to 298 with no gaps (tests/law.test.mjs), so the next and previous
 * links can never point at nothing.
 */

type Props = { params: Promise<{ n: string }> };

const articleAt = (n: number) => LAW.find((r) => r.kind === 'law' && r.n === n);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { n } = await params;
  return {
    title: `المادة ${n} — قانون العمل 14 لسنة 2025`,
    description: articleAt(Number(n))?.text.slice(0, 140),
  };
}

export default async function Article({ params }: Props) {
  const { n: raw } = await params;
  const n = Number(raw);
  const article = Number.isInteger(n) ? articleAt(n) : undefined;
  if (!article) notFound();
  const decrees = LAW.filter((r) => r.kind === 'decree' && r.under === n);

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-20 pt-10 sm:pt-14">
      <Link href="/" className="text-sm underline decoration-ink/25 underline-offset-4 opacity-70 hover:opacity-100">
        رجوع لجيسي
      </Link>
      {(article.chapter || article.part || article.book) && (
        <p className="mt-7 text-xs opacity-65">{article.chapter || article.part || article.book}</p>
      )}
      <h1 className="mt-1 text-[1.75rem] font-bold leading-tight tracking-tight sm:text-3xl">المادة {n}</h1>
      <span aria-hidden className="mt-3 block h-[2px] w-12 rounded-full bg-gold/70" />
      <p className="mt-7 whitespace-pre-line text-[0.95rem] leading-8">{article.text}</p>

      {decrees.length > 0 && (
        <section className="mt-10 border-t border-black/10 pt-6">
          <h2 className="text-base font-bold">القرار الوزاري المنفذ لها</h2>
          {decrees.map((d) => (
            <div key={d.id} className="mt-4">
              <p className="text-xs font-semibold opacity-70">
                قرار وزير العمل رقم {d.decree} لسنة {d.year}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-7 opacity-90">{d.text}</p>
            </div>
          ))}
        </section>
      )}

      <nav className="mt-10 flex justify-between border-t border-black/10 pt-5 text-sm">
        {n > 1 ? <Link href={`/law/${n - 1}`} className="underline underline-offset-4">المادة {n - 1}</Link> : <span />}
        <Link href="/law" className="underline underline-offset-4 opacity-70">كل المواد</Link>
        {n < 298 ? <Link href={`/law/${n + 1}`} className="underline underline-offset-4">المادة {n + 1}</Link> : <span />}
      </nav>
    </main>
  );
}
