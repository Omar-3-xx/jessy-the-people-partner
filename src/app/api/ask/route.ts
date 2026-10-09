import { getCloudflareContext } from '@opennextjs/cloudflare';

import { guardReply } from '@/lib/ask-guard';
import { SYSTEM_PROMPT } from '@/lib/ask-prompt';
import { answerFrom, detectLang, type Lang } from '@/lib/kb';
import { ENTRIES, FALLBACK } from '@/lib/kb-data';
import { latinDigits } from '@/lib/numbers';
import { aiBindingFrom, askWorkersAI, WORKERS_AI_MODEL } from '@/lib/workers-ai';

/*
 * Jessy's server. The knowledge base answers first: every leave question whose
 * article was read off the law's own text is answered in words that were
 * checked. Only a question the knowledge base cannot place reaches a model.
 *
 * Two can answer it and either is enough. Workers AI is a binding on the
 * Cloudflare account the site already runs on, so it needs no key at all;
 * Gemini answers when GEMINI_API_KEY is set. Both are free tiers, so the site
 * costs nothing to run — and because the allowances are counted separately, one
 * being spent for the day does not silence her.
 *
 * Whichever replies, the reply must pass guardReply against the conversation,
 * which throws away any legal figure it did not get from the conversation
 * itself; then the knowledge base's own answer is sent instead.
 *
 * Nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 500;
const MAX_TURNS = 8;
const WINDOW_MS = 5 * 60_000;
const PER_WINDOW = 20;
/** One call to one provider. */
const CALL_TIMEOUT_MS = 12_000;
/** Every provider together, because she is being waited for out loud. */
const TOTAL_BUDGET_MS = 20_000;
/*
 * Pinned, not 'latest': on a site about the law, a model that changes under us changes how
 * borderline questions are handled. Each id was checked against the live API, twice over —
 * ListModels is not enough on its own. `gemini-2.0-flash` is absent from it altogether, while
 * `gemini-2.5-flash` and `gemini-2.5-flash-lite` are both listed and both answer 404, "no
 * longer available to new users". Each would have 404'd on every call, and the site would have
 * looked merely forgetful rather than broken.
 *
 * A lite model, because Gemini's free allowance is counted per model per day and
 * `gemini-3.8-flash` grants twenty calls — Google's own quota error names the number,
 * GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20 — which an afternoon of testing spends
 * before the first visitor arrives. The lite model gives up nothing here, because Jessy may only
 * rephrase, ask what someone means, or say she does not know: every legal figure on this site is
 * the knowledge base's, and guardReply throws away a reply that states any other. Against the
 * real system prompt its answers ran 130-155 characters, finished cleanly and passed the guard —
 * the three in tests/ask-guard.test.mjs are those answers, word for word.
 *
 * A comma-separated JESSY_CHAT_MODEL adds ids, or changes the order, without a code deploy.
 */
const GEMINI_MODELS = (process.env.JESSY_CHAT_MODEL || 'gemini-3.1-flash-lite')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

/** The Cloudflare bindings, or null under `next dev`, which has no Cloudflare context at all. */
function cloudflareEnv(): unknown {
  try {
    return getCloudflareContext().env;
  } catch {
    return null;
  }
}

/** Questions per address in the last five minutes. One server's memory: enough to stop a loop, not a crowd. */
const recent = new Map<string, number[]>();

function limited(ip: string, now = Date.now()): boolean {
  const times = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) {
    recent.set(ip, times);
    return true;
  }
  times.push(now);
  recent.set(ip, times);
  // Forget quiet addresses now and then, so the map cannot grow without end.
  if (recent.size > 5_000) {
    for (const [key, list] of recent) if (!list.some((t) => now - t < WINDOW_MS)) recent.delete(key);
  }
  return false;
}

type Turn = { role: 'user' | 'assistant'; content: string };

/** The earlier turns, if they are well formed: user first, strictly alternating, each short. Anything else is dropped. */
function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw.slice(-MAX_TURNS) as Partial<Turn>[];
  if (turns[0]?.role === 'assistant') turns.shift();
  const out: Turn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const role = turns[i]?.role;
    const content = turns[i]?.content;
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected || typeof content !== 'string' || !content.trim() || content.length > MAX_CHARS) return [];
    out.push({ role, content: content.trim() });
  }
  // The question itself is the next user turn, so the history must end on Jessy's reply.
  return out.length % 2 === 0 ? out : out.slice(0, -1);
}

export async function POST(req: Request) {
  let body: { question?: unknown; lang?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad-request' }, { status: 400 });
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > MAX_CHARS) return Response.json({ error: 'bad-request' }, { status: 400 });
  // The site is Arabic only, so an English question still gets an Arabic answer.
  const pageLang: Lang = 'ar';

  // On Cloudflare the visitor's address is cf-connecting-ip, which Cloudflare sets itself; there the
  // first x-forwarded-for entry is whatever the visitor sent. Elsewhere, the host's proxy headers.
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local';
  if (limited(ip)) return Response.json({ error: 'busy' }, { status: 429, headers: { 'retry-after': '120' } });

  const local = answerFrom(ENTRIES, FALLBACK, question, pageLang);
  if (local.kind !== 'fallback') return Response.json(local);

  /*
   * Every way a model can fail from here ends at the same fallback sentence, which is right for
   * whoever asked and useless for us: no model bound at all, a 404 on a model id, a day's quota
   * spent, a reply that ran out of room, a reply the guard threw away — one answer from outside.
   * That is how a retired model id survived until a live key was tried, and how twenty calls a
   * day looked exactly like forgetfulness. So every exit below says which one it was, in Workers
   * Logs (observability is on in wrangler.jsonc). Never the key itself, only whether there is one.
   */
  const history = cleanHistory(body.history);
  const turns = [...history, { role: 'user' as const, content: question }];

  /*
   * The providers, in order. Workers AI is a binding on the same Cloudflare account the site
   * already runs on: no key to configure, and its allowance is Cloudflare's own daily neurons
   * rather than Gemini's twenty calls a day. Gemini follows as a second opinion on a separate
   * count, for when the binding is missing or its model will not answer. Either alone is enough
   * for the site to have a model at all.
   */
  const providers: { name: string; run: () => Promise<string> }[] = [];
  const ai = aiBindingFrom(cloudflareEnv());
  if (ai) providers.push({ name: WORKERS_AI_MODEL, run: () => askWorkersAI(ai, SYSTEM_PROMPT, turns, CALL_TIMEOUT_MS) });
  const key = process.env.GEMINI_API_KEY;
  if (key) for (const model of GEMINI_MODELS) providers.push({ name: model, run: () => askGemini(key, model, turns) });
  if (providers.length === 0) {
    console.warn('[ask] no model reachable: no AI binding and no GEMINI_API_KEY');
    return Response.json(local);
  }

  // A legal figure may only be repeated back, never produced: the conversation is the whole allowance.
  const context = turns.map((turn) => turn.content).join('\n');
  // Someone is reading this page aloud. Trying every provider in turn must still be shorter than
  // giving up on her, so the whole attempt is bounded, not just each call inside it.
  const started = Date.now();

  for (const provider of providers) {
    if (Date.now() - started > TOTAL_BUDGET_MS) {
      console.warn(`[ask] out of time after ${Date.now() - started}ms, ${provider.name} not tried`);
      break;
    }
    let text: string;
    try {
      text = await provider.run();
    } catch (err) {
      // The message carries the provider's own reason — a retired id, a key the project does not
      // cover, a day's quota spent, a timeout. It is the sentence that would have saved a day.
      // The key is not in it: it travels in a header, and no reason here quotes one.
      console.warn(`[ask] ${provider.name}: ${err instanceof Error ? err.message.slice(0, 400) : 'unknown failure'}`);
      continue;
    }
    const safe = guardReply(text, context);
    if (!safe) {
      // The length says whether it replied at all; the text itself is built from someone's own
      // question and is not logged. The next provider is a different model, so it is worth
      // asking — and the guard decides that one on its own terms too.
      console.warn(`[ask] guard refused ${provider.name}, ${text.length} chars`);
      continue;
    }
    return Response.json({
      id: 'model',
      kind: 'model',
      lang: detectLang(question, pageLang),
      text: latinDigits(safe),
      mood: 'think',
    });
  }
  return Response.json(local);
}

/*
 * One Gemini call. A refusal is thrown with Gemini's own words in it, so the loop above can log
 * which failure it was and move on: that body is where "no longer available to new users" and
 * "GenerateRequestsPerDayPerProjectPerModel-FreeTier = 20" were finally read.
 */
async function askGemini(
  key: string,
  model: string,
  turns: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: turns.map((turn) => ({
          role: turn.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: turn.content }],
        })),
        generationConfig: {
          // 300 left no margin at all: the guard lets a 600-character reply through, and 600
          // characters of Arabic is close to 300 tokens by itself — so a long answer was cut
          // off, and then thrown away below for having been cut off.
          maxOutputTokens: 800,
          temperature: 0.2,
          // Gemini 3 spends the output budget on internal reasoning first, which cut every reply
          // off mid-word. Jessy only has to rephrase, ask what someone means, or say she does not
          // know, so she is given no thinking budget at all.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const data = (await res.json()) as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  };
  const candidate = data.candidates?.[0];
  // Half a sentence about the law is worse than none: a reply that ran out of room is dropped.
  if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`reply dropped, finishReason ${candidate.finishReason}`);
  }
  return (candidate?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((t): t is string => typeof t === 'string')
    .join('\n');
}
