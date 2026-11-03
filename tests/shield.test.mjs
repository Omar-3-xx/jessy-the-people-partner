import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { askCloudflare, checkHuman, makePass, passIsGood, TOKEN_HEADER } from '../src/lib/shield.ts';

const SECRET = 'test-secret';

const request = (headers = {}) => new Request('https://x.test/api/ask', { method: 'POST', headers });

/** Cloudflare answering a token, with a count of how often it was asked. */
function cloudflare(reply) {
  const fake = async () => {
    fake.calls++;
    return reply();
  };
  fake.calls = 0;
  return fake;
}
const says = (success) => cloudflare(() => Response.json({ success }));

const cookieFrom = (setCookie) => setCookie.split(';')[0];

test('with no secret set the shield is off and everyone goes through', async () => {
  const fake = says(false);
  assert.deepEqual(await checkHuman(request(), undefined, fake), { ok: true });
  assert.deepEqual(await checkHuman(request(), '', fake), { ok: true });
  assert.equal(fake.calls, 0);
});

test('a program with no proof is turned away, and Cloudflare is not even asked', async () => {
  const fake = says(true);
  assert.equal((await checkHuman(request(), SECRET, fake)).ok, false);
  assert.equal(fake.calls, 0);
});

test('a token Cloudflare rejects is turned away', async () => {
  assert.equal((await checkHuman(request({ [TOKEN_HEADER]: 'bad' }), SECRET, says(false))).ok, false);
});

test('a good token gets through and earns an hour-long pass that is safe from the page', async () => {
  const checked = await checkHuman(request({ [TOKEN_HEADER]: 'good' }), SECRET, says(true));
  assert.equal(checked.ok, true);
  assert.match(checked.setCookie, /^jessy_pass=/);
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api', 'Max-Age=3600']) {
    assert.ok(checked.setCookie.includes(part), part);
  }
});

test('the pass is enough the next time, and Cloudflare is not asked again', async () => {
  const { setCookie } = await checkHuman(request({ [TOKEN_HEADER]: 'good' }), SECRET, says(true));
  const fake = says(false);
  const again = await checkHuman(request({ cookie: `other=1; ${cookieFrom(setCookie)}` }), SECRET, fake);
  assert.equal(again.ok, true);
  assert.equal(again.setCookie, undefined);
  assert.equal(fake.calls, 0);
});

test('a pass cannot be forged, altered, moved to another secret or used after its hour', async () => {
  const now = 1_800_000_000_000;
  const pass = await makePass(SECRET, now);
  const [ends, signature] = pass.split('.');
  assert.equal(await passIsGood(pass, SECRET, now), true);
  assert.equal(await passIsGood(pass, SECRET, now + 59 * 60_000), true);
  assert.equal(await passIsGood(pass, SECRET, now + 60 * 60_000), false, 'after its hour');
  assert.equal(await passIsGood(pass, 'another', now), false, 'another secret');
  assert.equal(await passIsGood(`${Number(ends) + 86_400}.${signature}`, SECRET, now), false, 'a later end date');
  assert.equal(await passIsGood(`${ends}.${'0'.repeat(64)}`, SECRET, now), false, 'a made-up signature');
  for (const junk of ['', 'x', '.', `${ends}.`, `.${signature}`, `${ends}.zz`, `${pass}.extra`]) {
    assert.equal(await passIsGood(junk, SECRET, now), false, junk);
  }
});

test('if Cloudflare cannot be reached she keeps answering, without giving out a pass', async () => {
  for (const fake of [cloudflare(() => new Response('', { status: 503 })), cloudflare(() => Promise.reject(new Error('down')))]) {
    const checked = await checkHuman(request({ [TOKEN_HEADER]: 'any' }), SECRET, fake);
    assert.equal(checked.ok, true);
    assert.equal(checked.setCookie, undefined);
  }
});

test('Cloudflare is told the token, the secret and the address, as its API asks', async () => {
  let sent;
  await askCloudflare('tok', SECRET, '1.2.3.4', async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return Response.json({ success: true });
  });
  assert.equal(sent.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.deepEqual(sent.body, { secret: SECRET, response: 'tok', remoteip: '1.2.3.4' });
});

test('both routes check before they spend anything, and the page answers when asked for proof', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const ask = read('../src/app/api/ask/route.ts');
  assert.ok(ask.indexOf('checkHuman(req') > 0 && ask.indexOf('checkHuman(req') < ask.indexOf('await answerRequest(req)'), 'ask checks first');
  const speak = read('../src/app/api/speak/route.ts');
  assert.ok(speak.indexOf('checkHuman(req') > 0 && speak.indexOf('checkHuman(req') < speak.indexOf('await req.json()'), 'speak checks first');
  const page = read('../src/components/chat/ask.tsx');
  assert.match(page, /postAsHuman\('\/api\/ask'/);
  assert.match(page, /error === 'human'/);
  // The header's name lives in both halves because the page must not import the server's file.
  assert.ok(read('../src/lib/human.ts').includes(`'${TOKEN_HEADER}'`));
});
