import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { COMMON_QUESTIONS, FIRST_QUESTIONS } from '../src/lib/law/common-questions.ts';
import { commonId, readAnswer, readVoice, saveAnswer, saveVoice, shelfFrom, worthKeeping } from '../src/lib/law/common.ts';

/** The store as Cloudflare's behaves: json and bytes back out, and what was asked of it written down. */
function fakeShelf() {
  const items = new Map();
  return {
    items,
    async get(key, { type }) {
      if (!items.has(key)) return null;
      const value = items.get(key).value;
      return type === 'json' ? JSON.parse(value) : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    },
    async put(key, value, options) {
      items.set(key, { value, options });
    },
  };
}

const broken = {
  async get() {
    throw new Error('down');
  },
  async put() {
    throw new Error('down');
  },
};

const streamOf = (...pieces) =>
  new ReadableStream({
    start(out) {
      for (const piece of pieces) out.enqueue(piece);
      out.close();
    },
  });

test('a common question is known however it is spelled and punctuated', () => {
  const id = commonId('اترفدت من غير سبب، حقوقي إيه؟');
  assert.ok(id);
  assert.equal(commonId('اترفدت من غير سبب حقوقي ايه'), id);
  assert.equal(commonId('  اترفدت   من غير سبب ، حقوقي إيه ؟ '), id);
});

test('every question offered is on the kept list, and all of them are different', () => {
  for (const q of COMMON_QUESTIONS) assert.ok(commonId(q), q);
  assert.equal(new Set(COMMON_QUESTIONS.map(commonId)).size, COMMON_QUESTIONS.length);
  assert.equal(FIRST_QUESTIONS.length, 6);
});

test('anything a person added of their own is not a common question, so it is never kept', () => {
  assert.equal(commonId('اترفدت من غير سبب وأنا اسمي أحمد من شركة النور، حقوقي إيه؟'), null);
  assert.equal(commonId('حقوقي'), null);
  assert.equal(commonId(''), null);
});

test('only an answer she stands behind is kept', () => {
  const good = { kind: 'model', via: 'better', refused: [], web: [] };
  assert.equal(worthKeeping(good, 'better'), true);
  assert.equal(worthKeeping({ ...good, via: 'lighter' }, 'better'), false, 'the lighter model');
  assert.equal(worthKeeping({ ...good, kind: 'quoted' }, 'better'), false, 'a quote because no model answered');
  assert.equal(worthKeeping({ ...good, refused: ['meaning search: unavailable, words only'] }, 'better'), false, 'searched with words only');
  assert.equal(worthKeeping({ ...good, web: [{ title: 'x', url: 'y' }] }, 'better'), false, 'a figure off the web');
});

test('an answer comes back as it went in, and expires', async () => {
  const shelf = fakeShelf();
  const id = commonId(COMMON_QUESTIONS[0]);
  assert.equal(await readAnswer(shelf, id), null);
  await saveAnswer(shelf, id, { text: 'الإجابة', sources: [{ name: 'المادة 124' }] });
  assert.deepEqual(await readAnswer(shelf, id), { text: 'الإجابة', sources: [{ name: 'المادة 124' }] });
  const [{ options }] = [...shelf.items.values()];
  assert.ok(options.expirationTtl > 0);
});

test('a whole sound is kept and comes back byte for byte', async () => {
  const shelf = fakeShelf();
  const id = commonId(COMMON_QUESTIONS[0]);
  const a = new Uint8Array(30_000).fill(1);
  const b = new Uint8Array(30_000).fill(2);
  assert.equal(await saveVoice(shelf, id, streamOf(a, b), 20), true);
  const back = new Uint8Array(await readVoice(shelf, id));
  assert.equal(back.length, 60_000);
  assert.equal(back[0], 1);
  assert.equal(back[59_999], 2);
});

test('a sound cut short is never kept, or the next person hears half an answer', async () => {
  const shelf = fakeShelf();
  const id = commonId(COMMON_QUESTIONS[0]);
  assert.equal(await saveVoice(shelf, id, streamOf(new Uint8Array(1_000)), 500), false);
  assert.equal(await readVoice(shelf, id), null);
});

test('a store that is down costs her nothing', async () => {
  const id = commonId(COMMON_QUESTIONS[0]);
  assert.equal(await readAnswer(broken, id), null);
  assert.equal(await readVoice(broken, id), null);
  await saveAnswer(broken, id, { text: 'x' });
  assert.equal(await saveVoice(broken, id, streamOf(new Uint8Array(60_000)), 1), false);
  assert.equal(shelfFrom(null), null);
  assert.equal(shelfFrom({}), null);
});

test('the routes look on the shelf before they spend a model or her voice', () => {
  const ask = readFileSync(new URL('../src/app/api/ask/route.ts', import.meta.url), 'utf8');
  assert.ok(ask.indexOf('readAnswer(') > 0 && ask.indexOf('readAnswer(') < ask.indexOf('answerQuestion('), 'ask reads first');
  assert.match(ask, /history\.length \? null : commonId\(question\)/, 'a follow-up depends on what came before, so it is never kept');
  const speak = readFileSync(new URL('../src/app/api/speak/route.ts', import.meta.url), 'utf8');
  assert.ok(speak.indexOf('readVoice(') > 0 && speak.indexOf('readVoice(') < speak.indexOf('generativelanguage'), 'speak reads first');
  assert.match(speak, /speakable\(kept\.text, 'ar'\) === text/, 'only the kept answer itself may be kept as sound');
});

test('the Worker has the store bound', () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  assert.match(config, /"binding": "COMMON"/);
  assert.match(config, /"id": "[0-9a-f]{32}"/);
});
