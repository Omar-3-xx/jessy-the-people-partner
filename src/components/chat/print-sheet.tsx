import { DISCLAIMER, printedOn } from '@/lib/law/share';

/*
 * The paper an answer is saved or printed on, and the only thing the printer sees. It is invisible
 * on screen. The articles are written out in full rather than folded, because a closed fold
 * prints as just its title, and a sheet shown to a manager has to carry the text it relies on.
 */

export type Sheet = {
  question: string;
  answer: string;
  sources: { name: string; href: string; text: string }[];
  web: { title: string; url: string }[];
  site: string;
};

export function PrintSheet({ sheet }: { sheet: Sheet }) {
  return (
    <article className="hidden text-[12pt] leading-relaxed text-ink print:block">
      <header className="border-b border-ink pb-2">
        <h1 className="text-[16pt] font-bold">جيسي: قانون العمل المصري، 14 لسنة&nbsp;2025</h1>
        <p className="mt-0.5 text-[10pt]">{printedOn()}</p>
      </header>

      <h2 className="mt-5 text-[11pt] font-bold">السؤال</h2>
      <p className="mt-1 whitespace-pre-line">{sheet.question}</p>

      <h2 className="mt-5 text-[11pt] font-bold">إجابة جيسي</h2>
      <p className="mt-1 whitespace-pre-line">{sheet.answer}</p>

      {sheet.sources.length > 0 && (
        <>
          <h2 className="mt-5 text-[11pt] font-bold">النص اللي الإجابة مبنية عليه</h2>
          {sheet.sources.map((source) => (
            <section key={source.name + source.text.slice(0, 20)} className="mt-2.5 break-inside-avoid text-[10.5pt]">
              <h3 className="font-semibold">{source.name}</h3>
              <p className="mt-0.5 whitespace-pre-line">{source.text}</p>
              <p className="mt-0.5 text-[9pt]" dir="ltr">
                {sheet.site}
                {source.href}
              </p>
            </section>
          ))}
        </>
      )}

      {sheet.web.length > 0 && (
        <>
          <h2 className="mt-5 text-[11pt] font-bold">من النت، مش من نص القانون</h2>
          {sheet.web.map((page) => (
            <p key={page.url} className="mt-1.5 text-[10pt]">
              {page.title}
              <span className="block text-[9pt]" dir="ltr">
                {page.url}
              </span>
            </p>
          ))}
        </>
      )}

      <p className="mt-6 border-t border-ink pt-2 font-bold">{DISCLAIMER}</p>
      <p className="mt-0.5 text-[9pt]" dir="ltr">
        {sheet.site}
      </p>
    </article>
  );
}
