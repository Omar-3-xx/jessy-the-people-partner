/*
 * Jessy's first model, and the one that needs nothing configured: Workers AI is
 * a binding on the same Cloudflare account the site already runs on, so there
 * is no API key to put anywhere, nothing to leak and nothing to rotate. Its
 * allowance is Cloudflare's own daily neurons rather than Gemini's twenty calls
 * a day, which is the whole reason it goes first.
 *
 * The model was chosen by measurement, not reputation. Five of the account's
 * text models were asked Jessy's eight hardest questions behind the real system
 * prompt, and each reply was put through guardReply:
 *
 *   @cf/meta/llama-4-scout-17b-16e-instruct        8/8 reached the reader, median 1.4s
 *   @cf/mistralai/mistral-small-3.1-24b-instruct   7/8, invented hour counts, once
 *                                                  rambled 2,614 characters over 22s
 *   @cf/qwen/qwen3.8-27b, @cf/google/gemma-4-26b   spent the whole token budget on
 *                                                  internal reasoning and returned
 *                                                  content: null
 *   @cf/meta/llama-3.1-8b-instruct-fp8             answered "30 يوم" out of thin air
 *
 * Asked how many days of annual leave, the chosen model says it does not know
 * and names the legal desk — which is exactly what Jessy is told to do.
 */

/** Only what this file calls. @cloudflare/workers-types is not a dependency here. */
export type AiBinding = {
  run(
    model: string,
    input: { messages: { role: string; content: string }[]; max_tokens?: number; temperature?: number },
  ): Promise<unknown>;
};

export const WORKERS_AI_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

/*
 * Two reply shapes come out of Workers AI and the difference is not documented
 * per model: the chosen model returns { response }, while the reasoning models
 * return an OpenAI-shaped object whose content can be null with the reasoning
 * filled in instead. Both are read here, and anything else reads as no reply at
 * all rather than as "[object Object]" in Jessy's mouth.
 */
export function aiReplyText(out: unknown): string {
  if (typeof out === 'string') return out;
  if (!out || typeof out !== 'object') return '';
  const o = out as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  if (typeof o.response === 'string') return o.response;
  if (o.response && typeof o.response === 'object') return aiReplyText(o.response);
  const content = o.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

/** The binding, or null when the site is running somewhere it does not exist. */
export function aiBindingFrom(env: unknown): AiBinding | null {
  const ai = (env as { AI?: unknown } | null | undefined)?.AI;
  return ai && typeof (ai as AiBinding).run === 'function' ? (ai as AiBinding) : null;
}

export async function askWorkersAI(
  ai: AiBinding,
  system: string,
  turns: { role: 'user' | 'assistant'; content: string }[],
  timeoutMs = 12_000,
  model = WORKERS_AI_MODEL,
): Promise<string> {
  // The binding takes no AbortSignal, so the wait is bounded from outside it. A model that
  // never answers must not hold the page: the caller has another provider to try.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ran = ai.run(model, {
    messages: [
      { role: 'system', content: system },
      ...turns.map((turn) => ({ role: turn.role === 'assistant' ? 'assistant' : 'user', content: turn.content })),
    ],
    // 800 for the same reason as Gemini: the guard lets a 600-character reply
    // through, and 600 characters of Arabic is close to 300 tokens by itself.
    max_tokens: 800,
    temperature: 0.2,
  });
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not answer within ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return aiReplyText(await Promise.race([ran, timedOut]));
  } finally {
    clearTimeout(timer);
  }
}
