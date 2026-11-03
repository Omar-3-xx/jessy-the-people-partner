import { getCloudflareContext } from '@opennextjs/cloudflare';

import { answerFrom, type Lang } from '@/lib/kb';
import { ENTRIES, FALLBACK } from '@/lib/kb-data';
import { answerQuestion, type Turn } from '@/lib/law/answer';
import { commonId, readAnswer, saveAnswer, shelfFrom, worthKeeping } from '@/lib/law/common';
import { lawIndex } from '@/lib/law/index';
import { GEMINI_DEFAULT, geminiProvider, workersAiProvider } from '@/lib/law/models';
import { latinDigits } from '@/lib/numbers';
import { checkHuman } from '@/lib/shield';
import { aiBindingFrom } from '@/lib/workers-ai';

/*
 * Jessy's server. A hello or a "who are you" is answered from a short fixed list. Everything else
 * goes to lib/law/answer.ts, which reads the whole law for it, and which is the same code the exam
 * in tests/ runs. Every exit says which model answered and why any before it did not, in Workers
 * Logs (observability is on in wrangler.jsonc). Never the key, never the person's words.
 *
 * Nothing anyone typed is stored here. Only the answers to the fixed common questions are kept
 * (common.ts). A person can choose to send an answer back as wrong, which is api/report.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 500;
const MAX_TURNS = 8;
const WINDOW_MS = 5 * 60_000;
const PER_WINDOW = 20;

/** The few things that are not a legal question, and need no model and no law. */
const SMALL_TALK = new Set(['who', 'greeting', 'thanks']);
const SMALL_ENTRIES = ENTRIES.filter((entry) => SMALL_TALK.has(entry.id));

const GEMINI_MODELS = (process.env.JESSY_CHAT_MODEL ?? '')
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

/*
 * The earlier turns, if they are well formed: user first, strictly alternating. Her own replies
 * are long now, far past the limit on a question, so they are shortened rather than refused: one
 * long reply must not cost the whole conversation its memory.
 */
function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns = raw.slice(-MAX_TURNS) as Partial<Turn>[];
  if (turns[0]?.role === 'assistant') turns.shift();
  const out: Turn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const role = turns[i]?.role;
    const content = turns[i]?.content;
    const expected = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected || typeof content !== 'string' || !content.trim()) return [];
    const limit = role === 'user' ? MAX_CHARS : 1_500;
    if (role === 'user' && content.length > limit) return [];
    out.push({ role, content: content.trim().slice(0, limit) });
  }
  // The question itself is the next user turn, so the history must end on Jessy's reply.
  return out.length % 2 === 0 ? out : out.slice(0, -1);
}

export async function POST(req: Request) {
  const human = await checkHuman(req, process.env.TURNSTILE_SECRET);
  if (!human.ok) return Response.json({ error: 'human' }, { status: 403 });
  const res = await answerRequest(req);
  if (human.setCookie) res.headers.append('set-cookie', human.setCookie);
  return res;
}

async function answerRequest(req: Request): Promise<Response> {
  let body: { question?: unknown; history?: unknown };
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

  const small = answerFrom(SMALL_ENTRIES, FALLBACK, question, pageLang);
  if (small.kind !== 'fallback') return Response.json({ ...small, sources: [], web: [] });

  const env = cloudflareEnv();
  const history = cleanHistory(body.history);
  const shelf = shelfFrom(env);
  // A follow-up means something only after what came before it, so it is never one of these.
  const common = history.length ? null : commonId(question);
  if (common && shelf) {
    const kept = await readAnswer(shelf, common);
    if (kept) {
      console.log('[ask] answered from the kept answers');
      return Response.json({ ...kept, common });
    }
  }

  const key = process.env.GEMINI_API_KEY;
  const models = GEMINI_MODELS.length ? GEMINI_MODELS : GEMINI_DEFAULT;
  const providers = key ? models.map((model) => geminiProvider(key, model)) : [];
  const ai = aiBindingFrom(env);
  if (ai) providers.push(workersAiProvider(ai));
  if (!providers.length) console.warn('[ask] no model reachable: no AI binding and no GEMINI_API_KEY');

  const answer = await answerQuestion({
    question,
    history,
    index: lawIndex(),
    providers,
    keys: { tavily: process.env.TAVILY_API_KEY, gemini: key, geminiModel: models[0] },
  });
  for (const why of answer.refused ?? []) console.warn(`[ask] ${why}`);
  if (answer.via) console.log(`[ask] answered by ${answer.via}`);

  const { via: _via, refused: _refused, ...sent } = answer;
  const reply = { ...sent, lang: 'ar', text: latinDigits(sent.text) };
  if (common && shelf && worthKeeping(answer, models[0])) await saveAnswer(shelf, common, reply);
  return Response.json({ ...reply, common: common ?? undefined });
}
