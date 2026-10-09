import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

import { ENTRIES, FALLBACK } from '../src/lib/kb-data.ts';
import { CLIPS, clipFor } from '../src/lib/talk/clips.ts';

/*
 * Her recorded voice. She says every answer that comes from the law in a real
 * person's voice, which only works while three separate things agree: the
 * knowledge base's ids, the manifest tools/build-voice.py writes, and the files
 * in public/voice. Add an entry to the knowledge base and that answer goes out
 * in the browser's robot voice with nothing saying so — which is exactly what
 * these assertions are here to catch.
 */

const ids = [...ENTRIES.map((e) => e.id), FALLBACK.id];
const voice = new URL('../public/voice/', import.meta.url);

/** 64 kb/s mono AAC, which is 8,000 bytes a second plus a small container. */
const BYTES_PER_SECOND = 8300;

test('every answer from the law has a recording', () => {
  const missing = ids.filter((id) => CLIPS[id] === undefined);
  assert.deepEqual(missing, [], `no recording for: ${missing.join(', ')}`);
});

test('no recording names an answer the knowledge base dropped', () => {
  const orphans = Object.keys(CLIPS).filter((id) => !ids.includes(id));
  assert.deepEqual(orphans, [], `recordings with no answer: ${orphans.join(', ')}`);
});

test('every recording is on disk, and is the length the manifest claims', () => {
  for (const [id, clip] of Object.entries(CLIPS)) {
    const file = new URL(`${clip.file}.m4a`, voice);
    let size;
    try {
      size = statSync(file).size;
    } catch {
      assert.fail(`${id}: public/voice/${clip.file}.m4a is not there`);
    }
    assert.ok(clip.seconds > 1 && clip.seconds < 120, `${id}: ${clip.seconds}s is not a spoken answer`);
    // A re-recorded line that was encoded but never re-manifested lands here: the file on disk
    // is a different length from the number the mouth is paced by, and nothing else would see it.
    const expected = clip.seconds * BYTES_PER_SECOND;
    assert.ok(
      size > expected * 0.7 && size < expected * 1.4,
      `${id}: ${clip.file}.m4a is ${size} bytes, but the manifest's ${clip.seconds}s implies about ${Math.round(expected)}`,
    );
  }
});

test('what a model said has no recording and must not claim one', () => {
  // The provider loop answers with id "model" when nothing in the law matched. Those words were
  // never read by anyone, so clipFor has to come back empty or she would play the wrong answer.
  assert.equal(clipFor('model'), null);
  assert.equal(clipFor(undefined), null);
  assert.equal(clipFor('busy'), null);
});

test('the chat hands the answer id to the voice', () => {
  // Without the id, speak() cannot find the recording and every answer quietly falls back to
  // speechSynthesis — the whole feature gone, with every test above still passing.
  const ask = readFileSync(new URL('../src/components/chat/ask.tsx', import.meta.url), 'utf8');
  assert.match(ask, /voice\.speak\(answer\.text,\s*answer\.id\)/);
  assert.match(ask, /mood: data\.mood, id: data\.id/);
  assert.match(ask, /mood: local\.mood, id: local\.id/);
});

test('the clips are cached but not for so long a re-recording is stuck behind them', () => {
  const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const rule = headers.match(/^\/voice\/\*\s*\n\s*Cache-Control:(.*)$/m);
  assert.ok(rule, 'public/_headers has no rule for /voice/*');
  const age = rule[1].match(/max-age=(\d+)/);
  assert.ok(age, `no max-age in: ${rule[1].trim()}`);
  // The names never change, so a long cache would serve a withdrawn recording for a week.
  assert.ok(Number(age[1]) <= 86400, `${age[1]}s is too long to live with a re-recording`);
});
