import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { aiReplyText, WORKERS_AI_MODEL } from '../src/lib/workers-ai.ts';

/*
 * Workers AI does not return one shape. The model Jessy uses returns { response }
 * with the text in it, and the reasoning models on the same account return an
 * OpenAI-shaped object whose content is null with the thinking filled in instead.
 * Reading only one of them is how a reply gets lost without a word in the logs;
 * reading the object carelessly is how "[object Object]" ends up in her mouth.
 * Every case below was returned by a real model on this account.
 */

test('the text is found in either shape Workers AI returns', () => {
  assert.equal(aiReplyText({ response: 'أهلاً بيك، ممكن توضح أكتر؟' }), 'أهلاً بيك، ممكن توضح أكتر؟');
  assert.equal(aiReplyText({ choices: [{ message: { content: 'أنا مش عارفة. اسأل الشؤون القانونية.' } }] }), 'أنا مش عارفة. اسأل الشؤون القانونية.');
  assert.equal(aiReplyText({ response: { choices: [{ message: { content: 'جوه جوه' } }] } }), 'جوه جوه');
  assert.equal(aiReplyText('نص على الناشف'), 'نص على الناشف');
});

test('a reply that is not there reads as empty, never as an object', () => {
  // The reasoning models really do answer like this: all the tokens spent thinking.
  assert.equal(aiReplyText({ choices: [{ message: { content: null, reasoning: 'We need answer in Egyptian Arabic' } }] }), '');
  assert.equal(aiReplyText({ choices: [] }), '');
  assert.equal(aiReplyText({}), '');
  assert.equal(aiReplyText(null), '');
  assert.equal(aiReplyText(undefined), '');
  assert.equal(aiReplyText(42), '');
  for (const out of [{}, null, { choices: [] }, { response: 7 }]) {
    assert.doesNotMatch(aiReplyText(out), /object/, 'never the word object');
  }
});

/*
 * The binding is the whole reason Jessy needs no API key. If this line is ever
 * dropped from the Worker's config she falls back to Gemini alone — twenty calls
 * a day — and nothing on the site would say so.
 */
test('the Worker still declares the AI binding', () => {
  const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const json = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
  assert.equal(json.ai?.binding, 'AI', 'wrangler.jsonc must bind AI');
  assert.equal(json.observability?.enabled, true, 'the logs that name each failure must stay on');
});

test('the model id is one the account actually serves', () => {
  // Measured 8/8 past the guard at a 1.4s median; the ids that failed are named in the source.
  assert.equal(WORKERS_AI_MODEL, '@cf/meta/llama-4-scout-17b-16e-instruct');
});
