'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import Image from 'next/image';
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Mic, RotateCcw, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { OPEN_CHAT_EVENT, type OpenChatDetail } from '@/components/chat/open-chat';
import { TigoFace, createFaceDriver, type FaceDriver } from '@/components/talk/tigo-face';
import { useEars, useVoice, type EarError } from '@/components/talk/use-speech';
import type { KbAnswer, Lang, Mood } from '@/lib/kb';
import { cn } from '@/lib/utils';

interface Message {
  id: number;
  from: 'tigo' | 'you';
  text: string;
  /** The language Tigo answered in, which follows the question, not the page. */
  lang?: Lang;
  link?: KbAnswer['link'];
}

/** What /api/ask sends back. */
interface Reply {
  text: string;
  lang: Lang;
  mood?: Mood;
  link?: KbAnswer['link'];
}

/** A line under the conversation: why the microphone or the voice did not work. */
type HintKey = 'noEars' | 'noVoice' | EarError;

const MAX_QUESTION = 500;
const HISTORY_TURNS = 8;
const SUGGESTIONS = ['s1', 's2', 's3', 's4'] as const;
const VOICE_KEY = 'tigo:voice';

let lastId = 0;
const nextId = () => ++lastId;

function readVoicePref(): boolean {
  try {
    return window.localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveVoicePref(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_KEY, on ? 'on' : 'off');
  } catch {
    // Private windows may refuse; the switch still works for this visit.
  }
}

/**
 * Talk to Tigo: his live face, his voice and his ears, over a conversation that
 * answers from what the carton says, in the language it is asked in. A button in
 * the corner of every page opens it, and so does any OpenChatButton, with a
 * question already asked. Tap the microphone and speak, or type. Tigo says his
 * answers aloud unless his voice is switched off. The conversation lives in this
 * tab only; when the server cannot be reached, Tigo answers from the same
 * knowledge base inside the browser.
 */
export function AskTigo() {
  const t = useTranslations('chat');
  const lang: Lang = useLocale() === 'ar' ? 'ar' : 'en';
  const titleId = useId();
  const greeting = useCallback((): Message => ({ id: 0, from: 'tigo', text: t('greeting'), lang }), [t, lang]);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [greeting()]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const [hint, setHint] = useState<HintKey | null>(null);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const greeted = useRef(false);
  const face = useRef<FaceDriver>(createFaceDriver());
  const moodTimer = useRef<number | undefined>(undefined);

  // Only the stable pieces, so nothing below re-subscribes on every render.
  const { speak, stop: hush, unlock, mouth, speaking } = useVoice();
  const { supported: canHear, listening, start: listen, stop: stopEars } = useEars();
  face.current.mouth = mouth;

  useEffect(() => setVoiceOn(readVoicePref()), []);

  // What the face shows: listening beats thinking beats speaking.
  useEffect(() => {
    face.current.state = listening ? 'listening' : busy ? 'thinking' : speaking ? 'speaking' : 'idle';
    // A joke's laugh or a safety answer's calm stays a moment after the words, then he smiles again.
    if (!speaking && !busy) {
      window.clearTimeout(moodTimer.current);
      moodTimer.current = window.setTimeout(() => {
        face.current.mood = 'happy';
      }, 2500);
    }
  }, [listening, busy, speaking]);

  useEffect(() => () => window.clearTimeout(moodTimer.current), []);

  const say = useCallback(
    (text: string, replyLang: Lang, mood: Mood = 'happy') => {
      window.clearTimeout(moodTimer.current);
      face.current.mood = mood;
      if (!voiceOn) return;
      if (!speak(text, replyLang)) setHint('noVoice');
    },
    [voiceOn, speak],
  );

  const openPanel = useCallback(() => {
    // Opening is a tap: the moment a phone lets a page start speaking.
    unlock();
    setOpen(true);
  }, [unlock]);

  // Any "ask Tigo" button on the page opens the chat, perhaps with its question.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenChatDetail>).detail;
      if (detail?.question) {
        greeted.current = true;
        setPending(detail.question);
      }
      openPanel();
    };
    window.addEventListener(OPEN_CHAT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
  }, [openPanel]);

  // Focus goes into the chat when it opens, and back to the corner button when it closes.
  // The first time it opens, Tigo says hello.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus({ preventScroll: true });
      if (!greeted.current) {
        greeted.current = true;
        say(t('greeting'), lang);
      }
    } else if (wasOpen.current) {
      hush();
      stopEars();
      launcherRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
    // Only opening and closing matter here; say and the rest are stable enough for that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, busy, open]);

  const send = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, MAX_QUESTION);
      if (!question || busy) return;
      hush();
      setHint(null);

      // The turns so far, oldest first, starting with a question: what the server passes on for context.
      const turns = messages.filter((m) => m.id !== 0).slice(-HISTORY_TURNS);
      if (turns[0]?.from === 'tigo') turns.shift();
      const history = turns.map((m) => ({ role: m.from === 'you' ? 'user' : 'assistant', content: m.text }));

      setMessages((list) => [...list, { id: nextId(), from: 'you', text: question }]);
      setDraft('');
      setBusy(true);

      let reply: Reply;
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question, lang, history }),
          signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
        });
        if (res.status === 429) reply = { text: t('busy'), lang, mood: 'calm' };
        else if (!res.ok) throw new Error(`ask ${res.status}`);
        else reply = (await res.json()) as Reply;
      } catch {
        // Offline, or the server is down: the same answers, from the browser.
        const [{ answerFrom }, { ENTRIES, FALLBACK }] = await Promise.all([import('@/lib/kb'), import('@/lib/kb-data')]);
        reply = answerFrom(ENTRIES, FALLBACK, question, lang);
      }

      setMessages((list) => [...list, { id: nextId(), from: 'tigo', text: reply.text, lang: reply.lang, link: reply.link }]);
      setBusy(false);
      say(reply.text, reply.lang, reply.mood);
    },
    [busy, messages, lang, t, hush, say],
  );

  // What the microphone hears arrives after later renders: it goes to the latest send.
  const sendLatest = useRef(send);
  sendLatest.current = send;

  useEffect(() => {
    if (!open || !pending || busy) return;
    setPending(null);
    void send(pending);
  }, [open, pending, busy, send]);

  function submit(e: FormEvent) {
    e.preventDefault();
    unlock();
    void send(draft);
  }

  function onInputKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      unlock();
      void send(draft);
    }
  }

  function toggleMic() {
    unlock();
    if (listening) {
      stopEars();
      return;
    }
    if (!canHear) {
      setHint('noEars');
      return;
    }
    // Tigo stops talking when you start: he listens.
    hush();
    setHint(null);
    listen(
      lang,
      (text, final) => {
        setDraft(text);
        if (final) void sendLatest.current(text);
      },
      (why) => setHint(why),
    );
  }

  function toggleVoice() {
    const on = !voiceOn;
    setVoiceOn(on);
    saveVoicePref(on);
    if (!on) hush();
    else unlock();
  }

  function restart() {
    hush();
    stopEars();
    setMessages([greeting()]);
    setDraft('');
    setHint(null);
    face.current.mood = 'happy';
    inputRef.current?.focus();
  }

  const status = listening ? t('listening') : busy ? t('thinking') : speaking ? t('speaking') : null;

  return (
    <>
      {!open ? (
        <button
          ref={launcherRef}
          type="button"
          onClick={openPanel}
          aria-haspopup="dialog"
          className="group fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] end-4 z-[55] flex items-center gap-3 border border-gold/50 bg-stage-night/90 py-1.5 pe-5 ps-1.5 text-cream shadow-[0_14px_34px_-14px_rgba(0,0,0,0.85),0_0_34px_-12px_rgb(var(--brand)/0.7)] backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-gold-light hover:shadow-[0_14px_34px_-14px_rgba(0,0,0,0.85),0_0_40px_-8px_rgb(var(--brand)/0.8)] sm:end-6 print:hidden"
        >
          <span className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-full bg-stage-raised ring-2 ring-gold/80">
            <Image src="/images/tigo-avatar.webp" alt="" fill sizes="40px" className="object-cover" />
          </span>
          <span className="font-display text-[14px] font-semibold uppercase tracking-[0.16em] group-hover:text-gold-light rtl:tracking-normal">{t('open')}</span>
          <span aria-hidden className="absolute -top-0.5 end-4 flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-brand/60 motion-reduce:animate-none" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-brand" />
          </span>
        </button>
      ) : null}

      {open ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          className="sheet-up fixed inset-x-0 bottom-0 z-[60] flex h-[92dvh] flex-col overflow-hidden border-t border-gold/45 bg-stage-deep shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] sm:inset-x-auto sm:bottom-6 sm:end-6 sm:h-[min(720px,calc(100dvh-7rem))] sm:w-[420px] sm:border print:hidden"
        >
          <header className="relative flex items-center gap-3 bg-stage-night px-4 py-3 text-cream">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-display text-[20px] font-bold uppercase leading-tight tracking-[0.04em] text-cream rtl:text-[17px] rtl:tracking-normal">
                {t('title')}
              </h2>
              <p className="truncate text-[12px] text-haze">{t('subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={toggleVoice}
              aria-pressed={voiceOn}
              aria-label={t('voice')}
              title={t('voice')}
              className="flex h-9 w-9 items-center justify-center border border-gold/30 text-cream transition-colors hover:border-gold-light hover:text-gold-light"
            >
              {voiceOn ? <Volume2 size={16} aria-hidden /> : <VolumeX size={16} aria-hidden className="text-mist" />}
            </button>
            <button
              type="button"
              onClick={restart}
              aria-label={t('restart')}
              title={t('restart')}
              className="flex h-9 w-9 items-center justify-center border border-gold/30 text-mist transition-colors hover:border-gold-light hover:text-gold-light"
            >
              <RotateCcw size={15} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              className="flex h-9 w-9 items-center justify-center border border-gold/30 text-cream transition-colors hover:border-gold-light hover:text-gold-light"
            >
              <X size={17} aria-hidden />
            </button>
            <span aria-hidden className="gold-hairline absolute inset-x-0 bottom-0 h-px" />
          </header>

          <div className="relative shrink-0 border-b border-gold/20">
            <TigoFace driver={face} label={t('faceLabel')} className="h-[clamp(170px,32dvh,270px)] w-full" />
            {status ? (
              <p
                aria-hidden
                className="absolute bottom-3 start-3 flex items-center gap-2 border border-gold/30 bg-stage-night/85 px-3 py-1 font-display text-[12.5px] font-semibold uppercase tracking-[0.14em] text-cream backdrop-blur-sm rtl:tracking-normal"
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', listening ? 'animate-pulse bg-coral motion-reduce:animate-none' : 'bg-brand-light')} />
                {status}
              </p>
            ) : null}
          </div>

          <div ref={logRef} role="log" aria-live="polite" aria-relevant="additions" className="ink-grid flex-1 space-y-4 overflow-y-auto px-4 py-5">
            {messages.map((m) =>
              m.from === 'tigo' ? (
                <div key={m.id} className="flex items-start gap-2.5">
                  <span aria-hidden className="relative mt-0.5 block h-7 w-7 shrink-0 overflow-hidden rounded-full bg-stage-raised ring-1 ring-gold/70">
                    <Image src="/images/tigo-avatar.webp" alt="" fill sizes="28px" className="object-cover" />
                  </span>
                  <div lang={m.lang} dir={m.lang === 'ar' ? 'rtl' : 'ltr'} className="max-w-[85%] border border-gold/15 bg-stage-card px-4 py-3 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.8)]">
                    <p className="sr-only">{t('tigoSays')}</p>
                    <p className="whitespace-pre-line text-[15px] leading-relaxed text-cream">{m.text}</p>
                    {m.link ? <ReplyLink link={m.link} newTab={t('newTab')} onFollow={() => !m.link?.external && setOpen(false)} /> : null}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-end">
                  <p dir="auto" className="max-w-[85%] whitespace-pre-line border border-brand/30 bg-brand/15 px-4 py-3 text-[15px] leading-relaxed text-cream">
                    <span className="sr-only">{t('youSaid')} </span>
                    {m.text}
                  </p>
                </div>
              ),
            )}

            {messages.length === 1 && !busy ? (
              <div className="ps-9">
                <p className="micro mb-2 text-gold">{t('try')}</p>
                <div className="flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        unlock();
                        void send(t(`suggestions.${s}`));
                      }}
                      className="border border-gold/35 bg-stage-card/80 px-3.5 py-2 text-start text-[14px] font-semibold text-gold-light transition-colors duration-300 hover:border-flame hover:bg-flame hover:text-navy"
                    >
                      {t(`suggestions.${s}`)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {busy ? (
              <div className="flex items-center gap-2.5" role="status">
                <span aria-hidden className="relative block h-7 w-7 shrink-0 overflow-hidden rounded-full bg-stage-raised ring-1 ring-gold/70">
                  <Image src="/images/tigo-avatar.webp" alt="" fill sizes="28px" className="object-cover" />
                </span>
                <span className="flex items-center gap-1.5 border border-gold/15 bg-stage-card px-4 py-3.5">
                  <span className="sr-only">{t('thinking')}</span>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      aria-hidden
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand motion-reduce:animate-none"
                      style={{ animationDelay: `${i * 0.18}s` }}
                    />
                  ))}
                </span>
              </div>
            ) : null}
          </div>

          <form onSubmit={submit} className="border-t border-gold/20 bg-stage-night/70 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
            {hint ? (
              <p role="status" className="mb-2 border-s-2 border-brand px-2.5 py-1 text-[12.5px] leading-snug text-cream">
                {t(`hints.${hint}`)}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={toggleMic}
                aria-pressed={listening}
                aria-label={listening ? t('stopListening') : t('listen')}
                title={listening ? t('stopListening') : t('listen')}
                className={cn(
                  'relative flex h-12 w-12 shrink-0 items-center justify-center transition-colors duration-300',
                  listening ? 'bg-coral text-navy hover:bg-coral/80' : 'border border-gold/40 bg-stage-card text-gold-light hover:border-brand hover:text-brand',
                )}
              >
                {listening ? (
                  <>
                    <span aria-hidden className="absolute inset-0 animate-ping bg-coral/40 motion-reduce:animate-none" />
                    <Square size={15} aria-hidden className="relative fill-current" />
                  </>
                ) : (
                  <Mic size={19} aria-hidden />
                )}
              </button>
              <label htmlFor="ask-tigo-input" className="sr-only">
                {t('label')}
              </label>
              <textarea
                ref={inputRef}
                id="ask-tigo-input"
                rows={1}
                dir="auto"
                value={draft}
                maxLength={MAX_QUESTION}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onInputKey}
                placeholder={listening ? t('listening') : t('placeholder')}
                className="field max-h-32 min-h-[48px] resize-none py-3 leading-snug [field-sizing:content]"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                aria-label={t('send')}
                className="flex h-12 w-12 shrink-0 items-center justify-center flame-fill shadow-[0_8px_24px_-8px_rgb(var(--brand)/0.8)] transition-[filter,box-shadow] duration-300 hover:brightness-110 disabled:bg-stage-rule disabled:bg-none disabled:text-haze disabled:shadow-none"
              >
                <Send size={18} aria-hidden className="rtl:-scale-x-100" />
              </button>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-haze">{t('disclaimer')}</p>
          </form>
        </section>
      ) : null}
    </>
  );
}

/** A page on this site closes the chat and goes there; the shop or Sato Pharma opens in a new tab. */
function ReplyLink({ link, newTab, onFollow }: { link: NonNullable<KbAnswer['link']>; newTab: string; onFollow: () => void }) {
  const className =
    'mt-2.5 inline-flex items-center gap-1.5 border-b border-brand/40 pb-0.5 text-[13px] font-bold text-brand transition-colors hover:border-brand';
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener" className={className}>
        {link.label}
        <ArrowUpRight size={13} aria-hidden className="rtl:-scale-x-100" />
        <span className="sr-only">{newTab}</span>
      </a>
    );
  }
  // The path already carries the language (/ar/height-check), so the plain Next link is the right one here.
  return (
    <NextLink href={link.href} onClick={onFollow} className={className}>
      {link.label}
    </NextLink>
  );
}
