/*
 * The page's half of the shield (shield.ts). Nothing is loaded from anywhere until the server has
 * asked for proof, so a visitor who only reads the law never touches Turnstile. Most people pass
 * without seeing anything; the box appears only if Cloudflare wants a tap.
 */

/** Public by design: it is sent to every browser, and only works on her address. */
const SITE_KEY = '0x4AAAAAAFymPMoVL9zv10us';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const GIVE_UP_MS = 60_000;

type Turnstile = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      language: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
      'timeout-callback': () => void;
    },
  ) => string;
  remove: (id: string) => void;
};

let loading: Promise<Turnstile | null> | null = null;

function loadTurnstile(): Promise<Turnstile | null> {
  const ready = () => (window as unknown as { turnstile?: Turnstile }).turnstile ?? null;
  loading ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve(ready());
    script.onerror = () => {
      // Blocked this time is not blocked for good: the next question tries again.
      loading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return loading;
}

function humanToken(): Promise<string | null> {
  return new Promise((resolve) => {
    void loadTurnstile().then((turnstile) => {
      if (!turnstile) return resolve(null);
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset-inline:0;bottom:6.5rem;z-index:30;display:flex;justify-content:center';
      document.body.appendChild(box);
      let id = '';
      let ended = false;
      const end = (token: string | null) => {
        if (ended) return;
        ended = true;
        window.clearTimeout(timer);
        if (id) turnstile.remove(id);
        box.remove();
        resolve(token);
      };
      const timer = window.setTimeout(() => end(null), GIVE_UP_MS);
      id = turnstile.render(box, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        language: 'ar-eg',
        callback: (token) => end(token),
        'error-callback': () => end(null),
        'expired-callback': () => end(null),
        'timeout-callback': () => end(null),
      });
    });
  });
}

/** A POST that proves it comes from a person, only if the server asks. */
export async function postAsHuman(url: string, body: unknown): Promise<Response> {
  const send = (extra: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
  const first = await send();
  if (first.status !== 403) return first;
  const token = await humanToken();
  return token ? send({ 'x-human-token': token }) : first;
}
