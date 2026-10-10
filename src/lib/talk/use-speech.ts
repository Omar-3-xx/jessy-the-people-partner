'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { clipFor } from '@/lib/talk/clips';
import { parseTrack, trackAt, type MouthTrack } from '@/lib/talk/mouth-track';
import { mouthAt, mouthTimeline, timeAtChar, timelineLength, type MouthKey, type MouthShape } from '@/lib/talk/visemes';
import { LOCALE, pauseAfter, pickVoice, pitchFor, sentences, speakable } from '@/lib/talk/voice';

/*
 * Jessy's voice and ears.
 *
 * Her answers from the law are a fixed list, so each one was read aloud once by
 * a real person and it is those recordings she speaks with (clips.ts). Only
 * what a model says has never been recorded, and that alone falls back to
 * speechSynthesis in Egyptian Arabic.
 *
 * Either way the mouth is driven off the text through one viseme timeline, and
 * either way the timeline is held to the sound rather than to a timer: a
 * recording's is stretched onto its real length and pulled back onto the audio
 * clock as it plays, and the browser's own voice reports each word so the
 * timeline is pulled onto that. Neither drifts away from what is being said.
 *
 * Her ears are SpeechRecognition. The microphone is open only between the tap
 * and the end of a sentence; nothing is recorded and nothing is kept.
 */

const LANG = 'ar' as const;

/** What the recordings are in. A browser that cannot play it uses its own voice instead. */
const CLIP_TYPE = 'audio/mp4; codecs="mp4a.40.2"';

/*
 * Twenty milliseconds of silence, 204 bytes of it. A phone plays audio only from a tap, and
 * only through an element that has already played inside one — so the tap that sends the
 * question plays this through the very element her recordings use, and the answer is allowed
 * to speak when it arrives a second later.
 */
const SILENCE =
  'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICA' +
  'gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg' +
  'ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

interface Saying {
  keys: MouthKey[];
  /** performance.now() at the timeline's zero, moved whenever the sound says where it is. */
  t0: number;
  /**
   * Her mouth as read off this very recording (mouth-track.ts). Once it has loaded it replaces
   * the text timeline, which stays as the mouth until then and for answers that have no track.
   */
  track?: MouthTrack;
  /** The recording's clock, kept so the mouth can move between the sound's coarse time updates. */
  clock?: { ct: number; at: number };
}

export interface Voice {
  /** This browser can say an answer aloud at all, by either route. */
  supported: boolean;
  speaking: boolean;
  /**
   * Says a reply aloud: her own recording of that answer when the id has one, the browser's
   * voice otherwise. False when neither can speak, so nothing is said.
   */
  speak: (text: string, id?: string) => boolean;
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
  const player = useRef<HTMLAudioElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const run = useRef(0);
  const unlocked = useRef(false);

  /** One element for every recording she ever plays, for the reason given at SILENCE. */
  const audio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined') return null;
    if (!player.current) {
      const el = new Audio();
      el.preload = 'auto';
      player.current = el;
    }
    return player.current;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = audio();
    const canPlay = el !== null && el.canPlayType(CLIP_TYPE) !== '';
    const load = () => {
      voices.current = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
      // Her recordings cover every answer from the law whatever voices this device has, so a
      // device with no Arabic voice still speaks — it only stays silent on what a model said.
      setSupported(canPlay || voices.current.length === 0 || pickVoice(voices.current, LANG) !== null);
    };
    load();
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.addEventListener?.('voiceschanged', load);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load);
      window.speechSynthesis.cancel();
      player.current?.pause();
      window.clearTimeout(timer.current);
    };
  }, [audio]);

  const stop = useCallback(() => {
    run.current++;
    window.clearTimeout(timer.current);
    saying.current = null;
    held.current = [];
    const el = player.current;
    if (el) {
      el.pause();
      el.ontimeupdate = null;
      el.onended = null;
      el.onerror = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const unlock = useCallback(() => {
    if (unlocked.current || typeof window === 'undefined') return;
    unlocked.current = true;
    const el = audio();
    if (el) {
      el.src = SILENCE;
      void el.play().catch(() => {});
    }
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  }, [audio]);

  /** The browser's own voice, sentence by sentence: what a model said, which nobody recorded. */
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

  /**
   * Her recording of one answer. False when this browser cannot play the file at all.
   * `refused` is for the one case that cannot be known in advance — a phone that blocks the
   * playback — and hands the line back to the browser's own voice.
   */
  const sayRecording = useCallback(
    (clip: { src: string; seconds: number }, text: string, refused: () => void) => {
      const el = audio();
      if (!el || el.canPlayType(CLIP_TYPE) === '') return false;
      stop();
      const mine = run.current;
      // The timeline is written for an average speaking pace; this is her real one, so it is
      // stretched onto the recording's own length before a frame is drawn.
      const plain = mouthTimeline(text);
      const rate = Math.max(0.3, timelineLength(plain) / Math.max(400, clip.seconds * 1000));
      saying.current = { keys: mouthTimeline(text, rate), t0: performance.now() };
      setSpeaking(true);
      el.src = clip.src;
      // The mouth read off the recording itself, fetched beside it; the text timeline covers the
      // moment before it arrives, and the whole answer if it never does.
      fetch(clip.src.replace(/\.m4a$/, '.mouth'))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          const track = buf ? parseTrack(new Uint8Array(buf)) : null;
          if (track && run.current === mine && saying.current) saying.current.track = track;
        })
        .catch(() => {});
      el.ontimeupdate = () => {
        const now = saying.current;
        // Where the sound has actually reached, four times a second: the mouth is pulled onto it.
        if (run.current === mine && now) now.t0 = performance.now() - el.currentTime * 1000;
      };
      const done = () => {
        if (run.current !== mine) return;
        saying.current = null;
        setSpeaking(false);
      };
      el.onended = done;
      el.onerror = done;
      void el.play().catch(() => {
        if (run.current !== mine) return;
        done();
        refused();
      });
      return true;
    },
    [audio, stop],
  );

  const speak = useCallback(
    (text: string, id?: string) => {
      const recorded = clipFor(id);
      if (recorded && sayRecording(recorded, text, () => sayWithBrowser(text))) return true;
      return sayWithBrowser(text);
    },
    [sayRecording, sayWithBrowser],
  );

  const mouth = useCallback((): MouthShape | null => {
    const now = saying.current;
    if (!now) return null;
    if (now.track) {
      const el = audio();
      if (el) {
        // currentTime moves in steps; between steps the mouth rides the page's own clock.
        const at = performance.now();
        if (!now.clock || now.clock.ct !== el.currentTime) now.clock = { ct: el.currentTime, at };
        const ahead = el.paused ? 0 : Math.min(60, at - now.clock.at);
        return trackAt(now.track, now.clock.ct * 1000 + ahead);
      }
    }
    const length = timelineLength(now.keys);
    let t = performance.now() - now.t0;
    // The sound is slower than the estimate: keep the last words moving until it really ends.
    if (t > length && length > 500) t = length - 450 + ((t - length) % 400);
    return mouthAt(now.keys, t);
  }, [audio]);

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
