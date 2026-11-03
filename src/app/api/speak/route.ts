/*
 * Her voice for any answer, since no answer is fixed any more and nobody can record what has not
 * been said yet. Gemini's speech model streams raw 16-bit PCM at 24 kHz, and it is passed on as it
 * comes: measured on a 18-second answer, the first sound arrives in 1.2 seconds and the whole of it
 * in 5, where waiting for the whole file would leave her silent for those 5. The page plays the
 * chunks through Web Audio (use-speech.ts).
 *
 * It only reads what she just said aloud: the text is checked to be short and in Arabic, and the
 * direction above it is fixed here, so this is not a free speech service for the open internet.
 * A refusal is a plain 503 and the page falls back to the browser's voice.
 *
 * Her voice for a common question is kept the first time it is said (common.ts), so the free key's
 * few voice calls are spent on what has never been said.
 */

import { getCloudflareContext } from '@opennextjs/cloudflare';

import { commonId, readAnswer, readVoice, saveVoice, shelfFrom, type Shelf } from '@/lib/law/common';
import { speakable } from '@/lib/talk/voice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 1_500;
const WINDOW_MS = 5 * 60_000;
const PER_WINDOW = 20;
// Covers the whole stream, and the longest answer she may give runs about two minutes aloud.
const TIMEOUT_MS = 120_000;
const VOICE = process.env.JESSY_VOICE || 'Sulafat';
const MODELS = (process.env.JESSY_VOICE_MODEL || 'gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts').split(',');

const DIRECTION =
  'Read this in natural Cairene Egyptian Arabic, the way a warm, confident, senior HR partner speaks to a colleague: ' +
  'calm, clear, unhurried, with a real smile in the voice. Pronounce ج as the hard Egyptian g. ' +
  'Do not sound like a news reader or an advert.\n\n';

const recent = new Map<string, number[]>();

function limited(ip: string, now = Date.now()): boolean {
  const times = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5_000) recent.clear();
  return times.length > PER_WINDOW;
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Gemini's stream of events, down to the bare sound inside them. */
function soundOnly(events: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let pending = '';
  return events.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        pending += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');
        let end: number;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const event = pending.slice(0, end);
          pending = pending.slice(end + 2);
          if (!event.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(event.slice(6)) as {
              candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[];
            };
            const audio = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
            if (audio) out.enqueue(fromBase64(audio));
          } catch {
            // One event that would not parse loses a blink of sound, not the answer.
          }
        }
      },
    }),
  );
}

/** The Worker's context, or null under `next dev`, which has no Cloudflare context at all. */
function cloudflare() {
  try {
    return getCloudflareContext();
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { text?: unknown; common?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const arabic = (text.match(/[ء-ي]/g) ?? []).length;
  if (!text || text.length > MAX_CHARS || arabic < text.length / 3) return new Response(null, { status: 400 });

  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (limited(ip)) return new Response(null, { status: 429 });

  const worker = cloudflare();
  const shelf = shelfFrom(worker?.env);
  const common = typeof body.common === 'string' ? commonId(body.common) : null;
  let keepIn: { shelf: Shelf; id: string } | null = null;
  if (common && shelf) {
    const kept = await readAnswer(shelf, common);
    // Only the words of the kept answer itself: this is not a place to store anything else.
    if (kept && speakable(kept.text, 'ar') === text) {
      const sound = await readVoice(shelf, common);
      if (sound) return new Response(sound, { headers: { 'content-type': 'audio/pcm;rate=24000', 'cache-control': 'no-store' } });
      keepIn = { shelf, id: common };
    }
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return new Response(null, { status: 503 });

  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.trim())}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: DIRECTION + text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      if (!res.ok || !res.body) {
        console.warn(`[speak] ${model} answered ${res.status}`);
        continue;
      }
      let sound = soundOnly(res.body);
      if (keepIn && worker) {
        const [toPage, toShelf] = sound.tee();
        sound = toPage;
        worker.ctx.waitUntil(saveVoice(keepIn.shelf, keepIn.id, toShelf, text.length));
      }
      return new Response(sound, {
        headers: { 'content-type': 'audio/pcm;rate=24000', 'cache-control': 'no-store' },
      });
    } catch (err) {
      console.warn(`[speak] ${model}: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
    }
  }
  return new Response(null, { status: 503 });
}
