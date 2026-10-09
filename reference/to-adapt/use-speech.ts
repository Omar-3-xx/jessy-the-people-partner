'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clipFor, clipMouth, loudnessAt, silentWav, type Clip, type ClipManifest } from '@/lib/talk/clips';
import { mouthAt, mouthTimeline, timeAtChar, timelineLength, type MouthKey, type MouthShape } from '@/lib/talk/visemes';
import { LOCALE, pauseAfter, pickVoice, pitchFor, sentences, speakable, type VoiceLang } from '@/lib/talk/voice';

/*
 * Tigo's ears and voice. His voice is recorded: every line he can say is recorded once by one real
 * Egyptian voice (clips.ts) and plays from an audio file, so it sounds the same on every phone and
 * browser. A line with no recording yet is read by the browser's own voice (speechSynthesis), as all
 * of them were before. His ears are the browser's: SpeechRecognition turns what a child says into
 * text. The microphone listens only between a tap and the end of what is said.
 */

// ── Voice ────────────────────────────────────────────────────────────────────

interface Saying {
  keys: MouthKey[];
  /** performance.now() at the timeline's zero, moved whenever the voice reports a word. */
  t0: number;
  /** While a recording plays: what plays it, how loud it is, and how the timeline stretches to its length. */
  clip?: { audio: HTMLAudioElement; env: string; stretch: number };
}

export interface Voice {
  /** The browser can speak at all. */
  supported: boolean;
  /** Tigo is saying something now. */
  speaking: boolean;
  /** Says a reply aloud. False when this device has no voice for the language, so nothing is said. */
  speak: (text: string, lang: VoiceLang) => boolean;
  stop: () => void;
  /** Called from a tap: iPhones let a page play sound or speak only once a tap has started it. */
  unlock: () => void;
  /** The mouth now, for the face; null while Tigo is quiet. */
  mouth: () => MouthShape | null;
}

let silence: string | undefined;

export function useVoice(): Voice {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const saying = useRef<Saying | null>(null);
  // Chrome drops an utterance nobody holds before it finishes; these hold them.
  const held = useRef<SpeechSynthesisUtterance[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const run = useRef(0);
  const unlocked = useRef(false);
  // One audio element plays every recording: a phone lets it play once a tap has played it.
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioUnlocked = useRef(false);
  const clips = useRef<ClipManifest | null>(null);

  useEffect(() => {
    let live = true;
    // The list of recordings loads after the page, well before anyone taps Tigo.
    import('@/lib/talk/clip-manifest')
      .then((m) => {
        if (live) clips.current = m.CLIPS;
      })
      .catch(() => {});
    if (typeof Audio !== 'undefined') setSupported(true);
    return () => {
      live = false;
      audio.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);
    const load = () => {
      voices.current = window.speechSynthesis.getVoices();
    };
    load();
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
      window.speechSynthesis.cancel();
      window.clearTimeout(timer.current);
    };
  }, []);

  const stop = useCallback(() => {
    run.current++;
    window.clearTimeout(timer.current);
    saying.current = null;
    held.current = [];
    const a = audio.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const unlock = useCallback(() => {
    if (!audioUnlocked.current && typeof Audio !== 'undefined') {
      audioUnlocked.current = true;
      const a = audio.current ?? (audio.current = new Audio());
      a.src = silence ??= silentWav();
      a.play().catch((err: unknown) => {
        // Refused, so no tap after all: the next tap tries again. Cut short by a recording: it worked.
        if ((err as { name?: string })?.name === 'NotAllowedError') audioUnlocked.current = false;
      });
    }
    if (unlocked.current || !('speechSynthesis' in window)) return;
    unlocked.current = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }, []);

  /** The browser's own voice, for a line with no recording. */
  const speakAloud = useCallback(
    (text: string, lang: VoiceLang) => {
      if (!('speechSynthesis' in window)) return false;
      const list = voices.current.length ? voices.current : window.speechSynthesis.getVoices();
      const voice = pickVoice(list, lang);
      // The voices are listed, and none speaks this language: better silent than wrong.
      if (!voice && list.length) return false;
      stop();
      const mine = run.current;
      const parts = sentences(speakable(text, lang, voice));
      if (!parts.length) return true;
      const rate = lang === 'ar' ? 0.95 : 1;
      const pitch = pitchFor(voice);
      setSpeaking(true);

      const sayPart = (n: number) => {
        if (run.current !== mine) return;
        if (n >= parts.length) {
          saying.current = null;
          held.current = [];
          setSpeaking(false);
          return;
        }
        const part = parts[n];
        const u = new SpeechSynthesisUtterance(part);
        u.lang = voice?.lang ?? LOCALE[lang];
        if (voice) u.voice = voice;
        u.rate = rate;
        u.pitch = pitch;
        const keys = mouthTimeline(part, rate);
        const begin = () => {
          if (run.current === mine) saying.current = { keys, t0: performance.now() };
        };
        begin();
        u.onstart = begin;
        u.onboundary = (e) => {
          const now = saying.current;
          if (run.current !== mine || !now || e.name === 'sentence') return;
          now.t0 = performance.now() - timeAtChar(now.keys, e.charIndex);
        };
        const next = () => {
          if (run.current !== mine) return;
          saying.current = null;
          timer.current = window.setTimeout(() => sayPart(n + 1), pauseAfter(part));
        };
        u.onend = next;
        u.onerror = next;
        held.current.push(u);
        window.speechSynthesis.speak(u);
      };
      sayPart(0);
      return true;
    },
    [stop],
  );

  /** A line's recording. Should it fail to load or play, the browser's voice says the line instead. */
  const play = useCallback(
    (text: string, lang: VoiceLang, clip: Clip) => {
      stop();
      const mine = run.current;
      const a = audio.current ?? (audio.current = new Audio());
      const keys = mouthTimeline(speakable(text, lang));
      const instead = () => {
        if (run.current === mine && !speakAloud(text, lang)) stop();
      };
      a.onended = () => {
        if (run.current !== mine) return;
        saying.current = null;
        setSpeaking(false);
      };
      a.onerror = instead;
      a.src = `/voice/${clip.f}`;
      saying.current = { keys, t0: performance.now(), clip: { audio: a, env: clip.e, stretch: timelineLength(keys) / Math.max(1, clip.d) } };
      setSpeaking(true);
      a.play().catch((err: unknown) => {
        // Stopped before it started is not a failure.
        if ((err as { name?: string })?.name !== 'AbortError') instead();
      });
    },
    [stop, speakAloud],
  );

  const speak = useCallback(
    (text: string, lang: VoiceLang) => {
      const clip = clips.current && typeof Audio !== 'undefined' ? clipFor(clips.current, text, lang) : null;
      if (!clip) return speakAloud(text, lang);
      play(text, lang, clip);
      return true;
    },
    [speakAloud, play],
  );

  const mouth = useCallback((): MouthShape | null => {
    const now = saying.current;
    if (!now) return null;
    if (now.clip) {
      // The recording says where it is: the mouth follows its sound, never a guess.
      const ms = now.clip.audio.currentTime * 1000;
      return clipMouth(mouthAt(now.keys, ms * now.clip.stretch), loudnessAt(now.clip.env, ms));
    }
    const length = timelineLength(now.keys);
    let t = performance.now() - now.t0;
    // The voice is slower than the estimate: keep the last words moving until it really ends.
    if (t > length && length > 500) t = length - 450 + ((t - length) % 400);
    return mouthAt(now.keys, t);
  }, []);

  return { supported, speaking, speak, stop, unlock, mouth };
}

// ── Ears ─────────────────────────────────────────────────────────────────────

/** Why listening stopped without words. */
export type EarError = 'blocked' | 'noSpeech' | 'noMic' | 'offline' | 'failed';

/** The little of SpeechRecognition used here; TypeScript's DOM types do not have it. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface Ears {
  supported: boolean;
  listening: boolean;
  /** Listens until the speaker stops. onText gets the words so far, and once more with final = true. */
  start: (lang: VoiceLang, onText: (text: string, final: boolean) => void, onError: (why: EarError) => void) => void;
  stop: () => void;
}

export function useEars(): Ears {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(recognitionClass() !== null);
    return () => rec.current?.abort();
  }, []);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback<Ears['start']>((lang, onText, onError) => {
    const Rec = recognitionClass();
    if (!Rec) return onError('failed');
    rec.current?.abort();
    const r = new Rec();
    rec.current = r;
    r.lang = LOCALE[lang];
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let heard = '';
    let done = false;
    r.onresult = (e) => {
      let text = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = e.results[i].isFinal;
      }
      heard = text.trim();
      if (final && heard && !done) {
        done = true;
        onText(heard, true);
      } else if (heard) onText(heard, false);
    };
    r.onerror = (e) => {
      if (e.error === 'aborted') return;
      done = true;
      const why: EarError =
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'blocked'
          : e.error === 'no-speech'
            ? 'noSpeech'
            : e.error === 'audio-capture'
              ? 'noMic'
              : e.error === 'network'
                ? 'offline'
                : 'failed';
      onError(why);
    };
    r.onend = () => {
      // Some browsers end without marking the last words final.
      if (!done && heard) onText(heard, true);
      done = true;
      if (rec.current === r) rec.current = null;
      setListening(false);
    };
    try {
      r.start();
      setListening(true);
    } catch {
      onError('failed');
    }
  }, []);

  return { supported, listening, start, stop };
}
