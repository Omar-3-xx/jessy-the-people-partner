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
 */

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

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return new Response(null, { status: 503 });

  let body: { text?: unknown };
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
      return new Response(soundOnly(res.body), {
        headers: { 'content-type': 'audio/pcm;rate=24000', 'cache-control': 'no-store' },
      });
    } catch (err) {
      console.warn(`[speak] ${model}: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
    }
  }
  return new Response(null, { status: 503 });
}
