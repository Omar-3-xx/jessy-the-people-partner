/*
 * Telling a person from a program before a model or her voice is spent on it. The free key has a
 * small daily allowance and one loop could burn all of it, and the limit per address in the routes
 * only sees one server's memory.
 *
 * A person proves it once through Cloudflare Turnstile and gets a signed pass good for an hour, so
 * Cloudflare is not asked again on every question. The pass is signed, not stored: there is no list
 * of visitors anywhere.
 *
 * With no secret set the shield is off and everything goes through. If Cloudflare itself cannot be
 * reached she keeps answering, because that outage is not the visitor's fault.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

const PASS_SECONDS = 60 * 60;
const COOKIE = 'jessy_pass';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 8_000;

export const TOKEN_HEADER = 'x-human-token';

const encoder = new TextEncoder();

function signingKey(secret: string, use: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(`jessy-pass:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);
}

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A pass: when it ends, and a signature nobody without the secret can make. */
export async function makePass(secret: string, now = Date.now()): Promise<string> {
  const ends = String(Math.floor(now / 1000) + PASS_SECONDS);
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret, 'sign'), encoder.encode(ends));
  return `${ends}.${toHex(signature)}`;
}

export async function passIsGood(pass: string, secret: string, now = Date.now()): Promise<boolean> {
  const [ends, signature, extra] = pass.split('.');
  if (!ends || !signature || extra !== undefined || !/^\d+$/.test(ends)) return false;
  if (Number(ends) * 1000 <= now) return false;
  const bytes = fromHex(signature);
  if (!bytes) return false;
  return crypto.subtle.verify('HMAC', await signingKey(secret, 'verify'), bytes, encoder.encode(ends));
}

function passIn(cookies: string | null): string | null {
  for (const part of (cookies ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && value) return value;
  }
  return null;
}

function passCookie(pass: string): string {
  return `${COOKIE}=${pass}; Path=/api; Max-Age=${PASS_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

/** What Cloudflare says of one token. A token works once, so it is never asked about twice. */
export async function askCloudflare(
  token: string,
  secret: string,
  ip: string | null,
  fetcher: typeof fetch = fetch,
): Promise<'person' | 'not' | 'unreachable'> {
  try {
    const res = await fetcher(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return res.status >= 500 ? 'unreachable' : 'not';
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? 'person' : 'not';
  } catch {
    return 'unreachable';
  }
}

export type Checked = { ok: boolean; setCookie?: string };

export async function checkHuman(req: Request, secret: string | undefined, fetcher: typeof fetch = fetch): Promise<Checked> {
  if (!secret) return { ok: true };
  const pass = passIn(req.headers.get('cookie'));
  if (pass && (await passIsGood(pass, secret))) return { ok: true };
  const token = req.headers.get(TOKEN_HEADER);
  if (!token || token.length > 4_096) return { ok: false };
  const said = await askCloudflare(token, secret, req.headers.get('cf-connecting-ip'), fetcher);
  if (said === 'not') return { ok: false };
  if (said === 'unreachable') {
    console.warn('[shield] Cloudflare could not be reached, letting this one through');
    return { ok: true };
  }
  return { ok: true, setCookie: passCookie(await makePass(secret)) };
}
