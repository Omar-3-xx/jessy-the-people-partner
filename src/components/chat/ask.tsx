'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { JessyFace, createFaceDriver, type FaceDriver, type FaceState } from '@/components/talk/jessy-face';
import { answerFrom, type KbAnswer, type Mood } from '@/lib/kb';
import { ENTRIES, FALLBACK } from '@/lib/kb-data';
import { EAR_MESSAGE, useEars, useVoice } from '@/lib/talk/use-speech';

/*
 * The chat. The server answers; if it cannot be reached at all, the same
 * knowledge base runs here in the browser, so the site still answers offline.
 *
 * Jessy is a face, not a picture: the driver below is a plain object the face
 * reads sixty times a second, so her mouth moves with the voice and her eyes
 * blink and glance without React re-rendering a thing. She listens through the
 * microphone and answers aloud; both are the browser's own, so nothing is
 * recorded and nothing leaves the device but the question itself.
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

/** What she is doing, in words, under the face. */
const CAPTION: Record<FaceState, string> = {
  idle: 'اسألني عن أي إجازة في قانون العمل',
  listening: 'بسمعك…',
  thinking: 'بفكر…',
  speaking: 'بتكلم',
};

export function Ask() {
  const [said, setSaid] = useState<Said[]>([]);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<FaceState>('idle');
  const endRef = useRef<HTMLDivElement>(null);

  const voice = useVoice();
  const ears = useEars();
  const driver = useRef<FaceDriver>(createFaceDriver());
  // The face reads the mouth every frame, so it is handed the live function rather than a copy.
  driver.current.mouth = voice.mouth;

  const setFace = useCallback((next: FaceState, mood?: Mood) => {
    driver.current.state = next;
    if (mood) driver.current.mood = mood;
    setState(next);
  }, []);

  // Speaking and listening both end on their own, so the face is put back by watching them
  // rather than by a timer that would guess wrong on a slow device.
  useEffect(() => {
    if (!voice.speaking && driver.current.state === 'speaking') setFace('idle', 'calm');
  }, [voice.speaking, setFace]);

  useEffect(() => {
    if (!ears.listening && driver.current.state === 'listening') setFace('idle', 'calm');
  }, [ears.listening, setFace]);

  const say = useCallback(
    (answer: { text: string; link?: KbAnswer['link']; mood?: Mood }) => {
      setSaid((prev) => [...prev, { who: 'jessy', text: answer.text, link: answer.link }]);
      const mood = answer.mood ?? 'calm';
      if (!muted && voice.speak(answer.text)) setFace('speaking', mood);
      else setFace('idle', mood);
    },
    [muted, voice, setFace],
  );

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || typing) return;
      setDraft('');
      voice.stop();
      const history = said.map((s) => ({ role: s.who === 'me' ? 'user' : 'assistant', content: s.text }));
      setSaid((prev) => [...prev, { who: 'me', text: q }]);
      setTyping(true);
      setFace('thinking');
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: q, lang: 'ar', history }),
        });
        const data = (await res.json()) as KbAnswer & { error?: string };
        if (data.error === 'busy') say({ text: 'في أسئلة كتير دلوقتي، جرب تاني بعد شوية.' });
        else say({ text: data.text, link: data.link, mood: data.mood });
      } catch {
        // The server could not be reached: the same knowledge base, in the browser.
        const local = answerFrom(ENTRIES, FALLBACK, q, 'ar');
        say({ text: local.text, link: local.link, mood: local.mood });
      } finally {
        setTyping(false);
        requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
      }
    },
    [typing, said, voice, say, setFace],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // A tap is what lets a phone speak at all, so every one of them unlocks the voice first.
    voice.unlock();
    void ask(draft);
  }

  function onMic() {
    voice.unlock();
    if (ears.listening) return ears.stop();
    voice.stop();
    setDraft('');
    setFace('listening');
    ears.start(
      (text, final) => {
        setDraft(text);
        if (final) void ask(text);
      },
      (why) => {
        setFace('idle', 'calm');
        setSaid((prev) => [...prev, { who: 'jessy', text: EAR_MESSAGE[why] }]);
      },
    );
  }

  function onMute() {
    const next = !muted;
    setMuted(next);
    if (next) {
      voice.stop();
      setFace('idle', 'calm');
    } else {
      voice.unlock();
    }
  }

  return (
    <div className="relative min-h-dvh">
      {/*
       * The page is hers. She stands on it at full height — no circle, no card, no ring, nothing
       * drawn around her — and the conversation sits beside her on a wide screen, below her on a
       * phone. Nothing is laid over her face.
       */}
      <div className="pointer-events-none fixed inset-0 z-0 md:right-auto md:w-[52vw]">
        <JessyFace driver={driver} label="جيسي" className="h-full w-full" />
      </div>

      {/*
       * The words keep off her face: below it on a phone, beside her on anything wider. Each bubble
       * is its own white, so where the conversation does run over her shoulder it stays readable.
       */}
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pb-32 pt-[58vh] md:ms-0 md:me-auto md:w-[44vw] md:max-w-xl md:ps-0 md:pe-6 md:pt-10">
        {/* On a phone she is the whole screen, so the title lands on her jumper and the grey
            subtitle under it could not be read at all. It gets the same white the answers get,
            rather than a band across her: she stays whole, the words stay legible. */}
        <header className="rounded-2xl bg-white/90 px-4 py-3 text-center shadow-sm backdrop-blur md:bg-transparent md:px-0 md:py-0 md:text-right md:shadow-none md:backdrop-blur-none">
          <div className="flex items-center justify-center gap-2 md:justify-end">
            <h1 className="text-2xl font-bold">جيسي</h1>
            {voice.supported && (
              <button
                type="button"
                onClick={onMute}
                aria-pressed={muted}
                aria-label={muted ? 'شغّل صوت جيسي' : 'اقفل صوت جيسي'}
                title={muted ? 'شغّل صوت جيسي' : 'اقفل صوت جيسي'}
                className="grid h-8 w-8 place-items-center rounded-full border border-black/10 bg-white/80 transition hover:border-black/30"
              >
                <SoundIcon off={muted} />
              </button>
            )}
          </div>
          <p className="mt-1 text-sm opacity-80">شريكتك في شؤون الموظفين — إجازات قانون العمل 14 لسنة 2025</p>
          <p className="mt-1 h-5 text-xs opacity-65" aria-live="polite">
            {CAPTION[state]}
          </p>
        </header>

        {said.length === 0 && (
          <div className="mt-5 grid gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  voice.unlock();
                  void ask(s);
                }}
                className="rounded-xl border border-black/10 bg-white/90 px-4 py-3 text-right text-sm shadow-sm backdrop-blur transition hover:border-black/25 hover:shadow"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="mt-6 space-y-4">
          {said.map((s, i) => (
            <div key={i} className={s.who === 'me' ? 'text-left' : 'text-right'}>
              <div
                className={
                  s.who === 'me'
                    ? 'inline-block max-w-[85%] rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-sm'
                    : 'answer inline-block max-w-[94%] rounded-2xl border border-black/10 bg-white/95 px-4 py-3 text-sm shadow-sm backdrop-blur'
                }
              >
                {s.text}
                {s.link && (
                  <>
                    {' '}
                    <Link
                      href={s.link.href}
                      className="whitespace-nowrap font-semibold underline decoration-gold decoration-2"
                    >
                      {s.link.label}
                    </Link>
                  </>
                )}
              </div>
              {/* Decision 3 of his sheet: the line sits under EVERY answer, not once at the bottom
                  of the page, so it is read with the answer and not scrolled past. Page at /law. */}
              {s.who === 'jessy' && (
                <p className="mt-1 text-[11px] opacity-55">ده شرح لنص القانون، مش استشارة قانونية.</p>
              )}
            </div>
          ))}
          {typing && <p className="text-right text-sm opacity-50">جيسي بتفكر…</p>}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-paper/90 backdrop-blur"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          {ears.supported && (
            <button
              type="button"
              onClick={onMic}
              aria-pressed={ears.listening}
              aria-label={ears.listening ? 'بطّل سماع' : 'اتكلم بدل ما تكتب'}
              title={ears.listening ? 'بطّل سماع' : 'اتكلم بدل ما تكتب'}
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border transition ${
                ears.listening
                  ? 'animate-pulse border-gold bg-gold/15 text-ink'
                  : 'border-black/15 bg-white hover:border-black/35'
              }`}
            >
              <MicIcon />
            </button>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder={ears.listening ? 'بسمعك…' : 'اسألني عن أي إجازة…'}
            aria-label="سؤالك"
            className="h-12 flex-1 rounded-xl border border-black/15 bg-white px-4 text-sm outline-none focus:border-ink"
          />
          <button
            type="submit"
            disabled={typing || !draft.trim()}
            className="h-12 shrink-0 rounded-xl bg-ink px-5 text-sm font-semibold text-white disabled:opacity-40"
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

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" strokeLinecap="round" />
      <path d="M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function SoundIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4z" strokeLinejoin="round" />
      {off ? (
        <path d="M16 9.5l4 5M20 9.5l-4 5" strokeLinecap="round" />
      ) : (
        <>
          <path d="M16 9.2a4 4 0 0 1 0 5.6" strokeLinecap="round" />
          <path d="M18.4 6.8a7.5 7.5 0 0 1 0 10.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
