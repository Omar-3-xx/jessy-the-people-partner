/*
 * The models that can answer as Jessy, best first.
 *
 * Gemini comes first because this job is reading Arabic legal text closely, and the
 * ones listed are the ones this key can reach; each has its own daily allowance, so
 * one running out passes to the next. Workers AI needs no key and has a separate
 * allowance, so she still has a model when every Gemini count is spent.
 */

import { askWorkersAI, type AiBinding, WORKERS_AI_MODEL } from '../workers-ai.ts';
import type { Provider, Turn } from './answer.ts';

const CALL_TIMEOUT_MS = 14_000;
/** A long answer in Arabic is close to 1,000 tokens, and half a sentence of law is worse than none. */
const MAX_TOKENS = 1_400;

export const GEMINI_DEFAULT = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

export function geminiProvider(key: string, model: string): Provider {
  return {
    name: model,
    run: async (system: string, turns: Turn[]) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: turns.map((turn) => ({
              role: turn.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: turn.content }],
            })),
            generationConfig: {
              maxOutputTokens: MAX_TOKENS,
              temperature: 0.1,
              // Reasoning spends the output budget first and cuts the reply off mid-word. The newest
              // lite model answers a budget of 0 with a bare 400 and takes a level instead; at
              // "minimal" it answered the words of a question and missed its case, so it gets "low".
              thinkingConfig: model.includes('3.5-flash-lite') ? { thinkingLevel: 'low' } : { thinkingBudget: 0 },
            },
          }),
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
      const data = (await res.json()) as {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
      };
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`reply dropped, finishReason ${candidate.finishReason}`);
      }
      // Parts can end in the middle of a word, so nothing goes between them.
      return (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
    },
  };
}

const EMBED_MODEL = 'gemini-embedding-2';
const EMBED_DIMS = 768;
const EMBED_TIMEOUT_MS = 3_000;

/**
 * What a question means, cut to the size the law's vectors were built at and back to unit length.
 * Null on any failure: the words still find the law, a little less well, so a question is never
 * held up by this. The model and size must stay those of tools/build-law-vectors.mjs.
 */
export async function embedQuestion(key: string, question: string, dims: number): Promise<number[] | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: question }] },
        outputDimensionality: EMBED_DIMS,
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    const cut = data.embedding?.values?.slice(0, dims);
    if (!cut?.length) return null;
    const length = Math.hypot(...cut);
    return length ? cut.map((v) => v / length) : null;
  } catch {
    return null;
  }
}

export function workersAiProvider(ai: AiBinding): Provider {
  return {
    name: WORKERS_AI_MODEL,
    run: (system: string, turns: Turn[]) => askWorkersAI(ai, system, turns, CALL_TIMEOUT_MS),
  };
}
