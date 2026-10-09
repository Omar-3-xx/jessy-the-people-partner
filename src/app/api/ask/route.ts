import { guardReply } from '@/lib/ask-guard';
import { SYSTEM_PROMPT } from '@/lib/ask-prompt';
import { answerFrom, detectLang, type Lang } from '@/lib/kb';
import { ENTRIES, FALLBACK } from '@/lib/kb-data';
import { latinDigits } from '@/lib/numbers';

/*
 * Jessy's server. The knowledge base answers first: every leave question whose
 * article was read off the law's own text is answered in words that were
 * checked. Only a question the knowledge base cannot place goes to a model, and
 * only when GEMINI_API_KEY is set — Gemini's free tier, so the site costs
 * nothing to run. The model's reply must pass guardReply against the
 * conversation, which throws away any legal figure it did not get from the
 * conversation itself; then the knowledge base's own answer is sent instead.
 *
 * Nothing is stored.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 500;
const MAX_TURNS = 8;
const WINDOW_MS = 5 * 60_000;
const PER_WINDOW = 20;
const MODEL = process.env.JESSY_CHAT_MODEL || 'gemini-2.0-flash';

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
  const key = process.env.GEMINI_API_KEY;
  if (local.kind !== 'fallback' || !key) return Response.json(local);

  const history = cleanHistory(body.history);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [...history, { role: 'user' as const, content: question }].map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.content }],
          })),
          generationConfig: { maxOutputTokens: 300, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return Response.json(local);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text)
      .filter((t): t is string => typeof t === 'string')
      .join('\n');
    // A legal figure may only be repeated back, never produced: the conversation is the whole allowance.
    const context = [...history.map((t) => t.content), question].join('\n');
    const safe = guardReply(text, context);
    if (!safe) return Response.json(local);
    return Response.json({
      id: 'model',
      kind: 'model',
      lang: detectLang(question, pageLang),
      text: latinDigits(safe),
      mood: 'think',
    });
  } catch {
    return Response.json(local);
  }
}
