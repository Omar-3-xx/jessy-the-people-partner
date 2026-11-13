import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every answer is read through the server voice, and the browser voice catches a failure', () => {
  // No answer is fixed any more, so a recording cannot be looked up by id. If either line goes,
  // she falls silent or reads with the device's voice, with every other test still passing.
  const ask = readFileSync(new URL('../src/components/chat/ask.tsx', import.meta.url), 'utf8');
  const speech = readFileSync(new URL('../src/lib/talk/use-speech.ts', import.meta.url), 'utf8');
  assert.match(ask, /voice\.speak\(answer\.text, answer\.common\)/);
  assert.match(speech, /fetch\('\/api\/speak'/);
  assert.match(speech, /else sayWithBrowser\(text\)/);
});

test('her voice is Sulafat, the one he chose, unless a setting says otherwise', () => {
  const route = readFileSync(new URL('../src/app/api/speak/route.ts', import.meta.url), 'utf8');
  assert.match(route, /process\.env\.JESSY_VOICE \|\| 'Sulafat'/);
});

test('only her words go to the voice model, which reads aloud whatever it is given', () => {
  // A direction in English above the words was read out before every answer (4 Nov 2026).
  const route = readFileSync(new URL('../src/app/api/speak/route.ts', import.meta.url), 'utf8');
  assert.match(route, /contents: \[\{ parts: \[\{ text \}\] \}\]/);
  assert.ok(!/Read this|Cairene|DIRECTION/.test(route));
});
