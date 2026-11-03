// Writes src/lib/law/law-vectors.json: what each record of the law MEANS, as numbers, so a question
// in any words can reach it. Run after build-law.py, with a Gemini key:
//   GEMINI_API_KEY=... node tools/build-law-vectors.mjs
// A record already embedded with the same text is kept (see the cache), so re-runs cost nothing.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MODEL = 'gemini-embedding-2';
const DIMS = 256;
const FULL = 768;
const BATCH = 40;
const PAUSE_MS = 35_000;

const root = new URL('../', import.meta.url);
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('GEMINI_API_KEY is needed');
const cachePath = process.env.VECTOR_CACHE;
const cache = cachePath && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

const records = JSON.parse(readFileSync(new URL('src/lib/law/law-data.json', root), 'utf8'));
const textOf = (r) => [r.chapter || r.part || r.book, r.text].filter(Boolean).join('\n').slice(0, 9000);
const hashOf = (text) => createHash('sha1').update(`${MODEL}:${FULL}:${text}`).digest('hex');

async function embed(texts, attempt = 0) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: FULL,
      })),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (res.status === 429 && attempt < 6) {
    console.log('429, waiting a minute');
    await new Promise((r) => setTimeout(r, 62_000));
    return embed(texts, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).embeddings.map((e) => e.values);
}

const todo = records.filter((r) => !cache[hashOf(textOf(r))]);
console.log(`${records.length} records, ${todo.length} to embed`);
for (let i = 0; i < todo.length; i += BATCH) {
  const part = todo.slice(i, i + BATCH);
  const vectors = await embed(part.map(textOf));
  part.forEach((r, j) => (cache[hashOf(textOf(r))] = vectors[j]));
  if (cachePath) writeFileSync(cachePath, JSON.stringify(cache));
  console.log(`${Math.min(i + BATCH, todo.length)} done`);
  if (i + BATCH < todo.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
}

// Cut to size, unit length again, and one signed byte a number: a fifth of a megabyte, not ten.
const bytes = new Int8Array(records.length * DIMS);
records.forEach((r, i) => {
  const cut = cache[hashOf(textOf(r))].slice(0, DIMS);
  const length = Math.hypot(...cut);
  // Scaled up because a unit vector's numbers are small, and held at the edge: a byte would wrap.
  cut.forEach((v, j) => (bytes[i * DIMS + j] = Math.max(-127, Math.min(127, Math.round((v / length) * 127 * 2.5)))));
});
writeFileSync(
  new URL('src/lib/law/law-vectors.json', root),
  JSON.stringify({ model: MODEL, dims: DIMS, ids: records.map((r) => r.id), data: Buffer.from(bytes.buffer).toString('base64') }),
);
console.log('written');

// The exam's questions as well, so the test measures the search the site really runs without
// needing a key. Each is embedded the way a visitor's question is.
const exam = JSON.parse(readFileSync(new URL('tests/law-exam.json', root), 'utf8'));
const unseen = exam.filter((q) => !cache[hashOf(q.q)]);
for (let i = 0; i < unseen.length; i += BATCH) {
  const part = unseen.slice(i, i + BATCH);
  const vectors = await embed(part.map((q) => q.q));
  part.forEach((q, j) => (cache[hashOf(q.q)] = vectors[j]));
  if (cachePath) writeFileSync(cachePath, JSON.stringify(cache));
  if (i + BATCH < unseen.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
}
const asked = Object.fromEntries(
  exam.map((q) => {
    const cut = cache[hashOf(q.q)].slice(0, DIMS);
    const length = Math.hypot(...cut);
    return [q.id, Buffer.from(Int8Array.from(cut.map((v) => Math.max(-127, Math.min(127, Math.round((v / length) * 127 * 2.5))))).buffer).toString('base64')];
  }),
);
writeFileSync(new URL('tests/law-exam-vectors.json', root), JSON.stringify(asked));
console.log('exam written');
