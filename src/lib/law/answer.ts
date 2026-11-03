/*
 * One question, start to finish: find the law, search the web if the law cannot
 * settle it, ask a model, check what it said, and if no model's answer survives,
 * say the article itself rather than nothing.
 *
 * The models are passed in, so tests/ and the exam run this exact path against any
 * of them, and a page never has a different brain from its exam.
 */

import { PERSONA, questionPrompt } from '../ask-prompt.ts';
import { breaksPersona, dropGenderedCall, tidyEmoji } from '../ask-guard.ts';
import { checkAnswer, citedArticles } from './figures.ts';
import { embedQuestion } from './models.ts';
import { citeName, search, type Hit, type LawIndex, type LawRecord } from './search.ts';
import { searchWeb, wantsWeb, type WebResult } from './web.ts';

export type Turn = { role: 'user' | 'assistant'; content: string };
export type Provider = { name: string; run: (system: string, turns: Turn[]) => Promise<string> };

export type SourceOut = { name: string; href: string; chapter?: string; text: string };
export type LawAnswer = {
  id: 'law' | 'law-quoted' | 'law-none';
  kind: 'model' | 'quoted' | 'none';
  text: string;
  mood: 'think' | 'calm';
  sources: SourceOut[];
  web: { title: string; url: string }[];
  /** For the logs and the exam: which model answered, and why any before it did not. */
  via?: string;
  refused?: string[];
};

/** How much of the law a model is shown for one question. */
const MAX_SOURCES = 12;
const MAX_SOURCE_CHARS = 16_000;
const MAX_ONE_SOURCE = 4_500;
const MAX_ANSWER_CHARS = 1_400;
/** Below this the best match is a coincidence of words, and quoting it would mislead. */
const QUOTABLE = 6;

/** An article has its own page, and a decree is read on the page of the article it sits under. */
function linkTo(record: LawRecord): string {
  const article = record.kind === 'law' ? record.n : record.under;
  return article ? `/law/${article}` : '/law';
}

function outOf(record: LawRecord, chars = 1_600): SourceOut {
  const text = record.text.length > chars ? `${record.text.slice(0, chars).trim()} …` : record.text;
  return { name: citeName(record), href: linkTo(record), chapter: record.chapter || undefined, text };
}

/** The sources shown under an answer: what it cited, or the best matches when it cited nothing. */
function sourcesFor(answer: string, hits: Hit[], index: LawIndex): SourceOut[] {
  const cited = citedArticles(answer)
    .map((n) => index.byArticle.get(n))
    .filter((r): r is LawRecord => !!r);
  const decrees = hits.filter(
    (h) => h.record.kind === 'decree' && answer.includes(String(h.record.decree)) && answer.includes(String(h.record.year)),
  );
  // A practice note is named under the answer whenever it was leaned on, so nobody takes it for law.
  const practice = answer.includes('الممارسة') ? hits.filter((h) => h.record.kind === 'practice').slice(0, 1) : [];
  const list = [...cited, ...decrees.map((h) => h.record), ...practice.map((h) => h.record)];
  return (list.length ? list : hits.slice(0, 2).map((h) => h.record)).slice(0, 6).map((r) => outOf(r));
}

/** A follow-up ("طب ولو 5 سنين؟") only makes sense with what came before it. */
function searchText(question: string, history: Turn[]): string {
  const lastAsked = [...history].reverse().find((t) => t.role === 'user')?.content ?? '';
  return question.length < 60 && lastAsked ? `${question} ${lastAsked}` : question;
}

export async function answerQuestion(input: {
  question: string;
  history: Turn[];
  index: LawIndex;
  providers: Provider[];
  keys: { tavily?: string; gemini?: string; geminiModel?: string };
}): Promise<LawAnswer> {
  const { question, history, index, providers, keys } = input;
  const asking = searchText(question, history);
  const vector = keys.gemini && index.meaning ? await embedQuestion(keys.gemini, asking, index.meaning.dims) : null;
  const hits = search(index, asking, MAX_SOURCES, vector);
  // How much of the question the law's words really share, which a record found by meaning alone
  // says nothing about: it decides whether to look on the web and whether a quote would mislead.
  const best = Math.max(0, ...hits.map((h) => h.score));

  let web: WebResult[] = [];
  let webOff = false;
  if (wantsWeb(question, best)) {
    const found = await searchWeb(`${question} قانون العمل مصر`, keys);
    web = found.results;
    webOff = !found.available || (found.results.length === 0 && best < QUOTABLE);
  }

  const picked: { name: string; chapter?: string; text: string }[] = [];
  const articles: number[] = [];
  let room = MAX_SOURCE_CHARS;
  for (const { record } of hits) {
    const text = record.text.slice(0, MAX_ONE_SOURCE);
    if (text.length > room) continue;
    room -= text.length;
    picked.push({ name: citeName(record), chapter: record.chapter || undefined, text });
    if (record.kind === 'law' && record.n) articles.push(record.n);
    if (record.under) articles.push(record.under);
  }
  const sourcesText = [...picked.map((s) => s.text), ...web.map((w) => w.text)].join('\n');
  const asked = [question, ...history.filter((t) => t.role === 'user').map((t) => t.content)].join('\n');
  const system = `${PERSONA}\n\n${questionPrompt({ sources: picked, web, webWasNeededButOff: webOff })}`;
  const turns: Turn[] = [...history, { role: 'user', content: question }];
  const webOut = web.map((w) => ({ title: w.title, url: w.url }));

  const refused: string[] = [];
  // Words alone miss what is said in other words. A day's allowance running out looks like nothing else.
  if (keys.gemini && index.meaning && !vector) refused.push('meaning search: unavailable, words only');
  let correction = '';
  for (const provider of providers) {
    let raw: string;
    try {
      raw = await provider.run(system + correction, turns);
    } catch (err) {
      refused.push(`${provider.name}: ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
      continue;
    }
    const text = dropGenderedCall(tidyEmoji(raw.replace(/\r/g, '').replace(/\*+/g, '').replace(/\n{3,}/g, '\n\n').trim()));
    if (!text || text.length > MAX_ANSWER_CHARS || breaksPersona(text)) {
      refused.push(`${provider.name}: unfit, ${text.length} chars`);
      continue;
    }
    // The site is Arabic only, and an English reply also slips past every citation check.
    if ((text.match(/[a-zA-Z]/g) ?? []).length > (text.match(/[ء-ي]/g) ?? []).length * 0.15) {
      refused.push(`${provider.name}: not in Arabic`);
      correction = '\n\nتنبيه: رد سابق اترفض لأنه مش بالعربي. الرد لازم يكون بالعامية المصرية.';
      continue;
    }
    const verdict = checkAnswer(text, sourcesText, asked, articles);
    if (!verdict.ok) {
      // Never logged with the words themselves, only the reason: the words carry someone's case.
      refused.push(`${provider.name}: ${verdict.why}`);
      correction = `\n\nتنبيه: رد سابق اترفض لأنه ${verdict.why}. استخدمي فقط اللي في المصادر حرفياً.`;
      continue;
    }
    return {
      id: 'law',
      kind: 'model',
      text,
      mood: 'think',
      sources: sourcesFor(text, hits, index),
      web: webOut,
      via: provider.name,
      refused,
    };
  }

  // No model answered, or none could be trusted. The law's own words are still an answer.
  const top = hits.find((h) => h.score >= QUOTABLE);
  if (top) {
    const name = citeName(top.record);
    return {
      id: 'law-quoted',
      kind: 'quoted',
      text: `أقرب نص لسؤالك هو ${name}. بقوله زي ما هو: ${top.record.text.slice(0, 700).trim()}`,
      mood: 'calm',
      sources: hits.slice(0, 3).map((h) => outOf(h.record)),
      web: webOut,
      refused,
    };
  }
  return {
    id: 'law-none',
    kind: 'none',
    text: webOff
      ? 'السؤال ده محتاج معلومة حالية مش موجودة في نص القانون، ومش قادرة أتأكد منها دلوقتي. مش هخمن رقم في حاجة زي دي. جرب تاني بعد شوية أو اسأل مكتب العمل التابع ليك.'
      : 'مش لاقية نص في قانون العمل 14 لسنة 2025 بيجاوب على السؤال ده. ممكن توضحه بتفصيلة زيادة؟ إيه اللي حصل بالظبط في الشغل؟',
    mood: 'calm',
    sources: [],
    web: webOut,
    refused,
  };
}
