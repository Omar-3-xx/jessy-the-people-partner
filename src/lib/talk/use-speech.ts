'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { mouthAt, mouthTimeline, timeAtChar, timelineLength, type MouthKey, type MouthShape } from '@/lib/talk/visemes';
import { LOCALE, pauseAfter, pickVoice, pitchFor, sentences, speakable } from '@/lib/talk/voice';

/*
 * Jessy's voice and ears.
 *
 * No answer is a fixed line any more, so nothing can be recorded in advance: the
 * server reads each one aloud as it is written (api/speak), and if it cannot, the
 * browser's own voice says it in Egyptian Arabic.
 *
 * Either way the mouth is driven off the text through one viseme timeline, and
 * either way the timeline is held to the sound rather than to a timer: the
 * server's is stretched onto the sound's real length and pulled back onto the
 * audio clock as it plays, and the browser's own voice reports each word so the
 * timeline is pulled onto that. Neither drifts away from what is being said.
 *
 * Her ears are SpeechRecognition. The microphone is open only between the tap
 * and the end of a sentence; nothing is recorded and nothing is kept.
 */

const LANG = 'ar' as const;

/** The server's voice: bare 16-bit samples, one channel, this many a second. */
const VOICE_RATE = 24_000;
/** Gathered into pieces this long before playing, so a slow network stutters less. */
const PIECE_SECONDS = 0.3;
/** Her pace in seconds a character, measured, until the stream ending says the real length. */
const SECONDS_PER_CHAR = 0.105;

interface Saying {
  keys: MouthKey[];
  /** performance.now() at the timeline's zero, moved whenever the sound says where it is. */
  t0: number;
}

export interface Voice {
  /** This browser can say an answer aloud at all, by either route. */
  supported: boolean;
  speaking: boolean;
  /** Says a reply aloud, server first, then the browser. False when neither can speak. */
  speak: (text: string, common?: string) => boolean;
  stop: () => void;
  /** Called from a tap: phones let a page play or speak only once a tap has started it. */
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
  const sound = useRef<AudioContext | null>(null);
  const playing = useRef<AudioBufferSourceNode[]>([]);
  const reading = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const run = useRef(0);
  const unlocked = useRef(false);

  /** One context for everything she says. A phone lets it run only once a tap has started it. */
  const context = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
    if (!sound.current) sound.current = new AudioContext();
    return sound.current;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canPlay = 'AudioContext' in window;
    const load = () => {
      voices.current = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
      // The server's voice works whatever voices this device has, so a device with no Arabic
      // voice still speaks.
      setSupported(canPlay || voices.current.length === 0 || pickVoice(voices.current, LANG) !== null);
    };
    load();
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
      window.speechSynthesis.cancel();
      reading.current?.abort();
      void sound.current?.close();
      window.clearTimeout(timer.current);
    };
  }, []);

  const stop = useCallback(() => {
    run.current++;
    window.clearTimeout(timer.current);
    saying.current = null;
    held.current = [];
    reading.current?.abort();
    reading.current = null;
    for (const piece of playing.current) {
      try {
        piece.stop();
      } catch {
        // A piece that has not started or has already ended has nothing to stop.
      }
    }
    playing.current = [];
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const unlock = useCallback(() => {
    if (typeof window === 'undefined') return;
    // Every tap, not only the first: a phone suspends the context again when the page sleeps.
    void context()?.resume();
    if (unlocked.current) return;
    unlocked.current = true;
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }, [context]);

  /** The browser's own voice, sentence by sentence, for when the server cannot speak. */
  const sayWithBrowser = useCallback(
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

  /*
   * Her voice from the server, played as it arrives. The words are already on the page; the mouth
   * starts with the first sound, and when the stream ends and the real length is known, the
   * timeline is stretched onto it. A server that cannot speak hands the answer to the browser's
   * voice rather than leaving her silent; one that fails halfway just ends there.
   */
  const sayFromServer = useCallback(
    (text: string, common?: string) => {
      const ctx = context();
      if (!ctx) return false;
      stop();
      const mine = run.current;
      setSpeaking(true);
      void ctx.resume();
      const spoken = speakable(text, LANG);
      const reader = new AbortController();
      reading.current = reader;
      const plain = mouthTimeline(spoken);
      const paceFor = (seconds: number) => Math.max(0.3, timelineLength(plain) / Math.max(400, seconds * 1000));

      let next = 0;
      let startedAt = 0;
      let total = 0;
      const play = (samples: Int16Array) => {
        const buffer = ctx.createBuffer(1, samples.length, VOICE_RATE);
        const channel = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
        const piece = ctx.createBufferSource();
        piece.buffer = buffer;
        piece.connect(ctx.destination);
        if (!startedAt) {
          next = ctx.currentTime + 0.05;
          startedAt = next;
          const guess = spoken.length * SECONDS_PER_CHAR;
          saying.current = { keys: mouthTimeline(spoken, paceFor(guess)), t0: performance.now() + 50 };
        }
        // Fallen behind the network: start from now, and move the mouth by the same gap.
        if (next < ctx.currentTime) {
          const gap = ctx.currentTime + 0.02 - next;
          next += gap;
          if (saying.current) saying.current.t0 += gap * 1000;
        }
        piece.start(next);
        next += buffer.duration;
        total += buffer.duration;
        playing.current.push(piece);
      };
      const finish = () => {
        if (run.current !== mine) return;
        saying.current = null;
        playing.current = [];
        setSpeaking(false);
      };

      fetch('/api/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: spoken, common }),
        signal: reader.signal,
      })
        .then(async (res) => {
          if (!res.ok || !res.body) throw new Error(String(res.status));
          const stream = res.body.getReader();
          const piece = Math.round(VOICE_RATE * PIECE_SECONDS) * 2;
          let held = new Uint8Array(0);
          for (;;) {
            const { done, value } = await stream.read();
            if (run.current !== mine) return;
            if (value) {
              const joined = new Uint8Array(held.length + value.length);
              joined.set(held);
              joined.set(value, held.length);
              held = joined;
            }
            if (held.length >= piece || (done && held.length >= 2)) {
              const even = held.length - (held.length % 2);
              // Copied, because an Int16Array needs its bytes on an even start.
              play(new Int16Array(held.slice(0, even).buffer));
              held = held.slice(even);
            }
            if (done) break;
          }
          if (!startedAt) throw new Error('no sound');
          const now = saying.current;
          if (now) now.keys = mouthTimeline(spoken, paceFor(total));
          timer.current = window.setTimeout(finish, Math.max(0, (next - ctx.currentTime) * 1000));
        })
        .catch(() => {
          if (run.current !== mine) return;
          if (startedAt) finish();
          else sayWithBrowser(text);
        });
      return true;
    },
    [context, stop, sayWithBrowser],
  );

  const speak = useCallback(
    (text: string, common?: string) => sayFromServer(text, common) || sayWithBrowser(text),
    [sayFromServer, sayWithBrowser],
  );

  const mouth = useCallback((): MouthShape | null => {
    const now = saying.current;
    if (!now) return null;
    const length = timelineLength(now.keys);
    let t = performance.now() - now.t0;
    // The sound is slower than the estimate: keep the last words moving until it really ends.
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
