/*
 * Her answers to the common questions, kept so asking one twice costs nothing. The free key runs out
 * of answers after about 11 quick calls and of her voice after 4, and on a Worker the question and
 * the sound come back from here without a model or a search being touched at all.
 *
 * Only the fixed list in common-questions.ts is ever kept, so nobody's own case is stored. Only an
 * answer she would stand behind is kept: from her first-choice model, with meaning search working,
 * and with nothing from the web, which goes out of date. A kept answer that turns out wrong stays
 * wrong for up to KEEP_SECONDS, so ANSWERS_VERSION goes up whenever the law, the prompt or a kept
 * answer is corrected.
 *
 * Nothing here may stop her answering: any failure of the store reads as "not kept".
 */

import { COMMON_QUESTIONS } from './common-questions.ts';
import { normalise } from './search.ts';

const ANSWERS_VERSION = 2;
const KEEP_SECONDS = 30 * 24 * 60 * 60;
/** Her pace is about 0.1 s a character, so a third of that is a stream that was cut off. */
const MIN_SECONDS_PER_CHAR = 0.03;
const BYTES_PER_SECOND = 48_000;
const MAX_VOICE_BYTES = 24 * 1024 * 1024;

const flat = (question: string) => normalise(question).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const KNOWN = new Set(COMMON_QUESTIONS.map(flat));

/** Which common question this is, however it was spelled and punctuated, or null if it is not one. */
export function commonId(question: string): string | null {
  const id = flat(question);
  return KNOWN.has(id) ? id : null;
}

/** Only what this file calls. @cloudflare/workers-types is not a dependency here. */
export type Shelf = {
  get(key: string, options: { type: 'json' }): Promise<unknown>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer | Uint8Array, options: { expirationTtl: number }): Promise<void>;
};

/** The store, or null when the site is running somewhere it does not exist. */
export function shelfFrom(env: unknown): Shelf | null {
  const shelf = (env as { COMMON?: unknown } | null | undefined)?.COMMON;
  return shelf && typeof (shelf as Shelf).put === 'function' ? (shelf as Shelf) : null;
}

export type KeptAnswer = { text: string } & Record<string, unknown>;

const answerKey = (id: string) => `answer:${ANSWERS_VERSION}:${id}`;
const voiceKey = (id: string) => `voice:${ANSWERS_VERSION}:${id}`;

/** Whether an answer is good enough to give the next person without asking again. */
export function worthKeeping(
  answer: { kind: string; via?: string; refused?: string[]; web?: unknown[] },
  firstChoice: string,
): boolean {
  return answer.kind === 'model' && answer.via === firstChoice && !answer.refused?.length && !answer.web?.length;
}

export async function readAnswer(shelf: Shelf, id: string): Promise<KeptAnswer | null> {
  try {
    const kept = (await shelf.get(answerKey(id), { type: 'json' })) as KeptAnswer | null;
    return kept && typeof kept.text === 'string' ? kept : null;
  } catch (err) {
    console.warn(`[common] read: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
    return null;
  }
}

export async function saveAnswer(shelf: Shelf, id: string, answer: KeptAnswer): Promise<void> {
  try {
    await shelf.put(answerKey(id), JSON.stringify(answer), { expirationTtl: KEEP_SECONDS });
  } catch (err) {
    console.warn(`[common] save: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
  }
}

export async function readVoice(shelf: Shelf, id: string): Promise<ArrayBuffer | null> {
  try {
    return await shelf.get(voiceKey(id), { type: 'arrayBuffer' });
  } catch (err) {
    console.warn(`[common] voice read: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
    return null;
  }
}

/** Keeps the whole of the sound as it finishes playing. A stream cut short is never kept. */
export async function saveVoice(shelf: Shelf, id: string, sound: ReadableStream<Uint8Array>, chars: number): Promise<boolean> {
  try {
    const reader = sound.getReader();
    const pieces: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pieces.push(value);
      size += value.length;
      if (size > MAX_VOICE_BYTES) return false;
    }
    if (size < chars * MIN_SECONDS_PER_CHAR * BYTES_PER_SECOND) return false;
    const whole = new Uint8Array(size);
    let at = 0;
    for (const piece of pieces) {
      whole.set(piece, at);
      at += piece.length;
    }
    await shelf.put(voiceKey(id), whole, { expirationTtl: KEEP_SECONDS });
    return true;
  } catch (err) {
    console.warn(`[common] voice save: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
    return false;
  }
}
