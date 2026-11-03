/*
 * "This answer is wrong." The one place anything a person typed is kept, and only after they read
 * what will be sent and pressed send. The law text and the exam only find what someone thought to
 * ask; these are the questions real people asked and she got wrong.
 *
 * Kept: the question, her answer, the articles she cited, an optional note, and the date. There is
 * deliberately no column for an address or a name, so one cannot end up here by accident.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

const MAX_QUESTION = 500;
// Longer than the 1,500 the conversation keeps: the wrong sentence may be the last one.
const MAX_ANSWER = 4_000;
const MAX_NOTE = 300;
const MAX_ARTICLES = 20;
const MAX_ARTICLE_NAME = 80;
// The free database is small and a report costs nothing to send. Past this someone is filling it.
const MAX_KEPT = 5_000;

type Statement = { bind: (...values: unknown[]) => Statement };
export type ReportsDb = {
  prepare: (sql: string) => Statement;
  batch: (statements: Statement[]) => Promise<{ meta?: { changes?: number } }[]>;
};

export function reportsFrom(env: unknown): ReportsDb | null {
  const db = (env as { REPORTS?: unknown } | null | undefined)?.REPORTS;
  return db && typeof (db as ReportsDb).batch === 'function' ? (db as ReportsDb) : null;
}

export type Report = { question: string; answer: string; articles: string[]; note: string };

const text = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

/** What may be kept of what the page sent, or null if there is no question and answer to look at. */
export function cleanReport(raw: unknown): Report | null {
  const body = (raw ?? {}) as Record<string, unknown>;
  const question = text(body.question, MAX_QUESTION);
  const answer = text(body.answer, MAX_ANSWER);
  if (!question || !answer) return null;
  const articles = Array.isArray(body.articles)
    ? body.articles
        .slice(0, MAX_ARTICLES)
        .map((name) => text(name, MAX_ARTICLE_NAME))
        .filter(Boolean)
    : [];
  return { question, answer, articles, note: text(body.note, MAX_NOTE) };
}

const CREATE = `CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  articles TEXT NOT NULL,
  note TEXT NOT NULL
)`;

const INSERT = `INSERT INTO reports (at, question, answer, articles, note)
  SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM reports) < ?`;

/** True only if the row is really there, so the page never says "it arrived" when it did not. */
export async function saveReport(db: ReportsDb, report: Report, now = new Date()): Promise<boolean> {
  try {
    const results = await db.batch([
      db.prepare(CREATE),
      db
        .prepare(INSERT)
        .bind(now.toISOString(), report.question, report.answer, JSON.stringify(report.articles), report.note, MAX_KEPT),
    ]);
    return results[1]?.meta?.changes === 1;
  } catch (error) {
    console.warn(`[report] not saved: ${error instanceof Error ? error.message : 'unknown'}`);
    return false;
  }
}
