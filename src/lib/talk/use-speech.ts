'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { mouthAt, mouthTimeline, timeAtChar, timelineLength, type MouthKey, type MouthShape } from '@/lib/talk/visemes';
import { LOCALE, pauseAfter, pickVoice, pitchFor, sentences, speakable } from '@/lib/talk/voice';

/*
 * Jessy's voice and ears, both the browser's own.
 *
 * TigoGrow says its lines from recordings of one real voice, because its lines
 * are a fixed list. Jessy's are not: she answers from the law and from a model,
 * so there is nothing to record. She speaks with speechSynthesis in Egyptian
 * Arabic, and the mouth is driven off the same text through the voice's own
 * boundary events — the face moves with what is actually being said, not with
 * a timer that drifts.
 *
 * Her ears are SpeechRecognition. The microphone is open only between the tap
 * and the end of a sentence; nothing is recorded and nothing is kept.
 */

const LANG = 'ar' as const;

interface Saying {
  keys: MouthKey[];
  /** performance.now() at the timeline's zero, moved whenever the voice reports a word. */
  t0: number;
}

export interface Voice {
  /** This browser can speak Arabic at all. */
  supported: boolean;
  speaking: boolean;
  /** Says a reply aloud. False when the device has no Arabic voice, so nothing is said. */
  speak: (text: string) => boolean;
  stop: () => void;
  /** Called from a tap: phones let a page speak only once a tap has started it. */
  unlock: () => void;
  /** The mouth now, for the face; null while she is quiet. */
  mouth: () => MouthShape | null;
}

export function useVoice(): Voice {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const saying = useRef<Saying | null>(null);
  // Chrome drops an utterance nobody holds before it finishes; this holds them.
  const held = useRef<SpeechSynthesisUtterance[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const run = useRef(0);
  const unlocked = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const load = () => {
      voices.current = window.speechSynthesis.getVoices();
      // Only Arabic matters here. A device whose list is loaded and holds no Arabic voice stays
      // silent rather than reading the law in a French accent.
      setSupported(voices.current.length === 0 || pickVoice(voices.current, LANG) !== null);
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
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const unlock = useCallback(() => {
    if (unlocked.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    unlocked.current = true;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
      const list = voices.current.length ? voices.current : window.speechSynthesis.getVoices();
      const voice = pickVoice(list, LANG);
      // The voices are listed and none speaks Arabic: better silent than wrong.
      if (!voice && list.length) return false;
      stop();
      const mine = run.current;
      const parts = sentences(speakable(text, LANG, voice));
      if (!parts.length) return true;
      const rate = 0.95;
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
        u.lang = voice?.lang ?? LOCALE[LANG];
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
          // The voice has reached this character, so the mouth is pulled back onto it: a slow or
          // a fast device never drifts away from the sound.
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

  const mouth = useCallback((): MouthShape | null => {
    const now = saying.current;
    if (!now) return null;
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

/** What someone sees when the microphone gives up. Every one of them offers typing instead. */
export const EAR_MESSAGE: Record<EarError, string> = {
  blocked: 'المتصفح مش مديني إذن المايك. اسمح بالمايك من إعدادات الموقع، أو اكتب سؤالك.',
  noSpeech: 'مسمعتش حاجة. دوس على المايك وجرب تاني.',
  noMic: 'مفيش مايك شغال على الجهاز ده. اكتب سؤالك وأنا هجاوبك.',
  offline: 'النت فصل وأنا بسمع. جرب تاني أو اكتب سؤالك.',
  failed: 'المايك مش راضي يشتغل هنا. اكتب سؤالك وأنا هجاوبك.',
};

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
  start: (onText: (text: string, final: boolean) => void, onError: (why: EarError) => void) => void;
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

  const start = useCallback<Ears['start']>((onText, onError) => {
    const Rec = recognitionClass();
    if (!Rec) return onError('failed');
    rec.current?.abort();
    const r = new Rec();
    rec.current = r;
    r.lang = LOCALE[LANG];
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
