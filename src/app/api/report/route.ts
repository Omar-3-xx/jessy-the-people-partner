import { getCloudflareContext } from '@opennextjs/cloudflare';

import { cleanReport, reportsFrom, saveReport } from '@/lib/law/reports';
import { checkHuman } from '@/lib/shield';

/*
 * Someone pressing "this answer is wrong" and confirming what is sent (lib/law/reports.ts).
 * Who sent it is not kept. The address is used only for the limit below, and only in memory.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_MS = 10 * 60_000;
const PER_WINDOW = 5;

const recent = new Map<string, number[]>();

function limited(ip: string, now = Date.now()): boolean {
  const times = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) return true;
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5_000) {
    for (const [key, list] of recent) if (!list.some((t) => now - t < WINDOW_MS)) recent.delete(key);
  }
  return false;
}

function cloudflareEnv(): unknown {
  try {
    return getCloudflareContext().env;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const human = await checkHuman(req, process.env.TURNSTILE_SECRET);
  if (!human.ok) return Response.json({ error: 'human' }, { status: 403 });
  const res = await receive(req);
  if (human.setCookie) res.headers.append('set-cookie', human.setCookie);
  return res;
}

async function receive(req: Request): Promise<Response> {
  const report = cleanReport(await req.json().catch(() => null));
  if (!report) return Response.json({ error: 'bad-request' }, { status: 400 });

  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'local';
  if (limited(ip)) return Response.json({ error: 'busy' }, { status: 429 });

  const db = reportsFrom(cloudflareEnv());
  if (!db || !(await saveReport(db, report))) return Response.json({ error: 'not-saved' }, { status: 503 });
  return Response.json({ ok: true });
}
