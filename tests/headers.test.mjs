import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Two files set the site's headers and neither can cover for the other: next.config.mjs's
 * headers() reach the pages and /api/ask, while public/_headers reaches everything Cloudflare
 * serves straight from static assets — which is where /record/recorder.html lives. Each of
 * these assertions is a thing that broke, or would have.
 */

const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');

test('the recorder keeps its microphone on static assets', () => {
  // /record/recorder.html never reaches the Worker, so public/_headers is the ONLY thing that
  // grants it a microphone. A Permissions-Policy here that omits it silently kills the page
  // for whoever records her lines, and nothing else in the suite would notice.
  const policy = headers.match(/^\s*Permissions-Policy:(.*)$/m);
  assert.ok(policy, 'public/_headers sets no Permissions-Policy at all');
  assert.match(policy[1], /microphone=\(self\)/, `static assets do not allow the microphone: ${policy[1].trim()}`);
});

test('the chat keeps its microphone on the pages', () => {
  const policy = config.match(/'Permissions-Policy', value: '([^']*)'/);
  assert.ok(policy, 'next.config.mjs sets no Permissions-Policy at all');
  assert.match(policy[1], /microphone=\(self\)/, `the pages do not allow the microphone: ${policy[1]}`);
});

test('both files carry the same four security headers', () => {
  for (const name of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy']) {
    assert.ok(headers.includes(name + ':'), `public/_headers is missing ${name}`);
    assert.ok(config.includes(`'${name}'`), `next.config.mjs is missing ${name}`);
  }
});
