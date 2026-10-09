'use client';

import { useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { answerFrom, type KbAnswer } from '@/lib/kb';
import { ENTRIES, FALLBACK } from '@/lib/kb-data';

/*
 * The chat. The server answers; if it cannot be reached at all, the same
 * knowledge base runs here in the browser, so the site still answers offline.
 *
 * The talking face (components/talk/jessy-face.tsx) is not wired in yet: its
 * landmarks are measured but untuned, and a half-tuned face is worse than the
 * still portrait. The portrait shown here is the one the shader will drive.
 */

const SUGGESTIONS = [
  'أنا مستحق كام يوم إجازة في السنة؟',
  'الإجازة العارضة كام يوم؟',
  'إجازة الوضع كام شهر؟',
  'العطلات الرسمية كام مناسبة؟',
  'عايز أروح الحج، في إجازة؟',
  'في إجازة بدون مرتب في القانون؟',
];

type Said = { who: 'me' | 'jessy'; text: string; link?: KbAnswer['link'] };

export function Ask() {
  const [said, setSaid] = useState<Said[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || typing) return;
    setDraft('');
    const history = said.map((s) => ({ role: s.who === 'me' ? 'user' : 'assistant', content: s.text }));
    setSaid((prev) => [...prev, { who: 'me', text: q }]);
    setTyping(true);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, lang: 'ar', history }),
      });
      const data = (await res.json()) as KbAnswer & { error?: string };
      if (data.error === 'busy') {
        setSaid((prev) => [...prev, { who: 'jessy', text: 'في أسئلة كتير دلوقتي، جرب تاني بعد شوية.' }]);
      } else {
        setSaid((prev) => [...prev, { who: 'jessy', text: data.text, link: data.link }]);
      }
    } catch {
      // The server could not be reached: the same knowledge base, in the browser.
      const local = answerFrom(ENTRIES, FALLBACK, q, 'ar');
      setSaid((prev) => [...prev, { who: 'jessy', text: local.text, link: local.link }]);
    } finally {
      setTyping(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(draft);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24">
      <header className="flex flex-col items-center pt-10 text-center">
        <Image
          src="/images/jessy-portrait.webp"
          alt="جيسي"
          width={168}
          height={168}
          priority
          className="h-42 w-42 rounded-full object-cover ring-4 ring-white shadow-lg"
          style={{ height: 168, width: 168 }}
        />
        <h1 className="mt-5 text-2xl font-bold">جيسي</h1>
        <p className="mt-1 text-sm opacity-70">شريكتك في شؤون الموظفين — إجازات قانون العمل 14 لسنة 2025</p>
      </header>

      {said.length === 0 && (
        <div className="mt-8 grid gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              className="rounded-xl border border-black/10 bg-white px-4 py-3 text-right text-sm transition hover:border-black/25 hover:shadow-sm"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 space-y-4">
        {said.map((s, i) => (
          <div key={i} className={s.who === 'me' ? 'text-left' : 'text-right'}>
            <div
              className={
                s.who === 'me'
                  ? 'inline-block max-w-[85%] rounded-2xl bg-ink px-4 py-3 text-sm text-white'
                  : 'answer inline-block max-w-[92%] rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm'
              }
            >
              {s.text}
              {s.link && (
                <>
                  {' '}
                  <Link href={s.link.href} className="whitespace-nowrap font-semibold underline decoration-gold decoration-2">
                    {s.link.label}
                  </Link>
                </>
              )}
            </div>
            {/* Decision 3 of his sheet: the line sits under EVERY answer, not once at the bottom of
                the page, so it is read with the answer and not scrolled past. The page is at /law. */}
            {s.who === 'jessy' && (
              <p className="mt-1 text-[11px] opacity-55">ده شرح لنص القانون، مش استشارة قانونية.</p>
            )}
          </div>
        ))}
        {typing && <p className="text-right text-sm opacity-50">جيسي بتكتب…</p>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-paper/95 backdrop-blur"
      >
        <div className="mx-auto flex max-w-2xl gap-2 px-4 py-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder="اسألني عن أي إجازة…"
            aria-label="سؤالك"
            className="flex-1 rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={typing || !draft.trim()}
            className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            اسأل
          </button>
        </div>
        <p className="pb-2 text-center text-[11px] opacity-60">
          <Link href="/law" className="underline">
            حدود الإجابات دي ونصوص القانون
          </Link>
        </p>
      </form>
    </div>
  );
}
