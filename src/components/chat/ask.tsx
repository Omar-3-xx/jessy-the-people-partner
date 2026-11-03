'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { ReportWrong } from '@/components/chat/report-wrong';
import { JessyFace, createFaceDriver, type FaceDriver, type FaceState } from '@/components/talk/jessy-face';
import { postAsHuman } from '@/lib/human';
import type { KbAnswer, Mood } from '@/lib/kb';
import { FIRST_QUESTIONS, MORE_QUESTIONS } from '@/lib/law/common-questions';
import { EAR_MESSAGE, useEars, useVoice } from '@/lib/talk/use-speech';

/*
 * The chat. The server reads the law and answers, and each answer comes with the
 * articles it stands on, so anyone about to rely on it can read them in place. If
 * the server cannot be reached she says so: an old offline list of leave answers
 * used to run here instead, and could give a confident answer to the wrong question.
 *
 * Jessy is a face, not a picture: the driver below is a plain object the face
 * reads sixty times a second, so her mouth moves with the voice and her eyes
 * blink and glance without React re-rendering a thing. She listens through the
 * browser's microphone; nothing is recorded and nothing leaves the device but the
 * question itself.
 */

type Source = { name: string; href: string; chapter?: string; text: string };
type WebSource = { title: string; url: string };
/** `asked` is the question a real answer was given to. Her apologies and error lines have none. */
type Said = { who: 'me' | 'jessy'; text: string; link?: KbAnswer['link']; sources?: Source[]; web?: WebSource[]; asked?: string };

/** What she is doing, in words, under the face. */
const CAPTION: Record<FaceState, string> = {
  idle: 'اسألني في أي حاجة في قانون العمل',
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
  const [allQuestions, setAllQuestions] = useState(false);
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
    (answer: { text: string; link?: KbAnswer['link']; mood?: Mood; sources?: Source[]; web?: WebSource[]; common?: string; asked?: string }) => {
      setSaid((prev) => [
        ...prev,
        { who: 'jessy', text: answer.text, link: answer.link, sources: answer.sources, web: answer.web, asked: answer.asked },
      ]);
      const mood = answer.mood ?? 'calm';
      if (!muted && voice.speak(answer.text, answer.common)) setFace('speaking', mood);
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
        const res = await postAsHuman('/api/ask', { question: q, lang: 'ar', history });
        const data = (await res.json()) as KbAnswer & { error?: string; sources?: Source[]; web?: WebSource[]; common?: string };
        if (data.error === 'busy') say({ text: 'في أسئلة كتير دلوقتي، جرب تاني بعد شوية.' });
        else if (data.error === 'human') say({ text: 'مقدرتش أتأكد إن اللي بيسأل شخص مش برنامج. حدّث الصفحة وجرب تاني.' });
        else say({ text: data.text, link: data.link, mood: data.mood, sources: data.sources, web: data.web, common: data.common, asked: q });
      } catch {
        say({ text: 'مش قادرة أوصل لنص القانون دلوقتي، النت عندك أو عندي فيه مشكلة. جرب تاني كمان شوية.' });
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
       *
       * The column used to sit flush against the right edge of the window, with no padding on the
       * reading side at all, which cropped the subtitle at every width above a phone. It now keeps a
       * gutter, and starts lower down so the block sits optically placed rather than crammed under
       * the top edge with the rest of the page empty below it.
       */}
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pb-36 pt-[58vh] md:ms-0 md:me-auto md:w-[44vw] md:max-w-xl md:ps-10 md:pe-8 md:pt-[12vh]">
        {/* On a phone she is the whole screen, so the title lands on her jumper and the grey
            subtitle under it could not be read at all. It gets the same white the answers get,
            rather than a band across her: she stays whole, the words stay legible. */}
        <header className="rounded-2xl border border-black/5 bg-white/90 px-5 py-4 text-center shadow-sm backdrop-blur-md md:border-0 md:bg-transparent md:px-0 md:py-0 md:text-right md:shadow-none md:backdrop-blur-none">
          {/* justify-start, not justify-end: this row is inside dir="rtl", where the flex END is the
              LEFT. Ending it pushed her name into the middle of the column while every line beneath
              it began hard against the right edge. */}
          <div className="flex items-center justify-center gap-2.5 md:justify-start">
            <h1 className="text-2xl font-bold leading-none tracking-tight md:text-[2.1rem]">جيسي</h1>
            {voice.supported && (
              <button
                type="button"
                onClick={onMute}
                aria-pressed={muted}
                aria-label={muted ? 'شغّل صوت جيسي' : 'اقفل صوت جيسي'}
                title={muted ? 'شغّل صوت جيسي' : 'اقفل صوت جيسي'}
                className="grid h-8 w-8 place-items-center rounded-full border border-black/10 bg-white/80 text-ink/80 shadow-sm transition hover:border-black/25 hover:text-ink hover:shadow"
              >
                <SoundIcon off={muted} />
              </button>
            )}
          </div>

          {/* A short gold rule under her name: the one place the third colour stands on its own
              rather than only arriving on hover or underlining a link. */}
          <span aria-hidden className="mx-auto mt-3 block h-[2px] w-12 rounded-full bg-gold/70 md:ms-0 md:me-auto" />

          {/* The year used to break across two lines and leave "2025" stranded on the second. The
              non-breaking spaces hold "14 لسنة 2025" together; .balance evens what is left. */}
          <p className="balance mt-3 text-sm leading-relaxed opacity-85">
            شريكتك في شؤون الموظفين — قانون العمل المصري كله، 14 لسنة&nbsp;2025 وقراراته
          </p>

          <p
            className="mt-2 flex h-5 items-center justify-center gap-2 text-xs opacity-65 md:justify-start"
            aria-live="polite"
          >
            {(state === 'thinking' || state === 'listening') && <Dots />}
            <span>{CAPTION[state]}</span>
          </p>
        </header>

        {said.length === 0 && (
          <>
            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {(allQuestions ? [...FIRST_QUESTIONS, ...MORE_QUESTIONS] : FIRST_QUESTIONS).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  style={{ animationDelay: `${allQuestions ? 0 : 60 * i}ms` }}
                  onClick={() => {
                    voice.unlock();
                    void ask(s);
                  }}
                  className="chip rise rounded-xl px-4 py-3.5 text-right text-sm leading-relaxed"
                >
                  {s}
                </button>
              ))}
            </div>
            {!allQuestions && (
              <p className="mt-3 text-center md:text-right">
                <button
                  type="button"
                  onClick={() => setAllQuestions(true)}
                  className="rounded-md bg-white/85 px-2 py-0.5 text-sm underline decoration-gold underline-offset-4"
                >
                  أسئلة تانية بيسألوها كتير
                </button>
              </p>
            )}
          </>
        )}

        <div className="mt-7 space-y-4">
          {said.map((s, i) => (
            <div key={i} className={`rise ${s.who === 'me' ? 'text-left' : 'text-right'}`}>
              <div
                className={
                  s.who === 'me'
                    ? 'inline-block max-w-[85%] rounded-2xl rounded-tl-md bg-ink px-4 py-3 text-sm leading-relaxed text-white shadow-[var(--lift-2)]'
                    : 'answer surface inline-block max-w-[94%] rounded-2xl rounded-tr-md px-4 py-3 text-sm'
                }
              >
                <span className="whitespace-pre-line">{s.text}</span>
                {s.link && (
                  <>
                    {' '}
                    <Link
                      href={s.link.href}
                      className="whitespace-nowrap font-semibold underline decoration-gold decoration-2 underline-offset-4 transition hover:text-gold"
                    >
                      {s.link.label}
                    </Link>
                  </>
                )}
              </div>
              {s.who === 'jessy' && !!(s.sources?.length || s.web?.length) && (
                <Sources sources={s.sources ?? []} web={s.web ?? []} />
              )}
              {/* Decision 3 of his sheet: the line sits under EVERY answer, not once at the bottom
                  of the page, so it is read with the answer and not scrolled past. Page at /law. */}
              {s.who === 'jessy' && (
                <p className="mt-1.5">
                  {/* It stays OUTSIDE the bubble, as his sheet has it. But on a phone she fills the
                      screen and this line was landing on her navy jumper — 11px of navy at 55% on
                      navy, which is the one line on the page that must never be hard to read. It
                      gets its own small white behind it, the same white the answer has. */}
                  <span className="inline-block rounded-md bg-white/85 px-2 py-0.5 text-[11px] text-ink/70 backdrop-blur-sm">
                    ده شرح لنص القانون، مش استشارة قانونية.
                  </span>
                </p>
              )}
              {s.asked && (
                <div className="mt-1.5">
                  <ReportWrong question={s.asked} answer={s.text} articles={(s.sources ?? []).map((source) => source.name)} />
                </div>
              )}
            </div>
          ))}
          {typing && (
            <p className="flex items-center justify-start gap-2 text-sm opacity-55">
              <Dots />
              <span>جيسي بتفكر…</span>
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-black/5 bg-paper/85 shadow-[0_-10px_30px_-20px_rgb(27_42_74_/_0.35)] backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 pb-1.5 pt-3">
          {ears.supported && (
            <button
              type="button"
              onClick={onMic}
              aria-pressed={ears.listening}
              aria-label={ears.listening ? 'بطّل سماع' : 'اتكلم بدل ما تكتب'}
              title={ears.listening ? 'بطّل سماع' : 'اتكلم بدل ما تكتب'}
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border transition ${
                ears.listening
                  ? 'listening border-gold bg-gold/10 text-ink'
                  : 'border-black/15 bg-white shadow-sm hover:border-black/35 hover:shadow'
              }`}
            >
              <MicIcon />
            </button>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder={ears.listening ? 'بسمعك…' : 'احكيلي اللي حصل في الشغل…'}
            aria-label="سؤالك"
            className="h-12 flex-1 rounded-xl border border-black/15 bg-white px-4 text-sm shadow-sm outline-none transition placeholder:text-ink/40 focus:border-ink/45 focus:shadow"
          />
          <button
            type="submit"
            disabled={typing || !draft.trim()}
            className="h-12 shrink-0 rounded-xl bg-ink px-6 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:shadow-md active:translate-y-0 disabled:translate-y-0 disabled:opacity-35 disabled:shadow-none"
          >
            اسأل
          </button>
        </div>
        <p className="pb-2.5 text-center text-[11px]">
          <Link
            href="/law"
            className="underline decoration-ink/25 underline-offset-4 opacity-60 transition hover:decoration-gold hover:opacity-100"
          >
            حدود الإجابات دي ونصوص القانون
          </Link>
        </p>
      </form>
    </div>
  );
}

/**
 * What an answer stands on: the articles it cited, opened in place, and any page from the web
 * with its address showing, so a stranger's site is never mistaken for the law. A plain ruled
 * list on the same white as the answer, because this is a thing to read and not a decoration.
 */
function Sources({ sources, web }: { sources: Source[]; web: WebSource[] }) {
  return (
    <div className="surface mt-1.5 inline-block w-full max-w-[94%] rounded-xl px-4 py-2 text-right text-xs">
      {sources.map((source) => (
        <details key={source.name + source.text.slice(0, 20)} className="border-b border-black/5 py-1.5 last:border-b-0">
          <summary className="cursor-pointer font-semibold">{source.name}</summary>
          <p className="mt-1.5 whitespace-pre-line leading-6 opacity-85">{source.text}</p>
          <Link href={source.href} className="mt-1 inline-block underline decoration-gold underline-offset-4">
            النص كامل
          </Link>
        </details>
      ))}
      {web.length > 0 && (
        <div className="py-1.5">
          <p className="font-semibold">من النت، مش من نص القانون:</p>
          {web.map((page) => (
            <a
              key={page.url}
              href={page.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="mt-1 block truncate underline underline-offset-4 opacity-85"
            >
              {page.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/** Three dots that say "working" without a word, and without changing width while they run. */
function Dots() {
  return (
    <span className="dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
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
