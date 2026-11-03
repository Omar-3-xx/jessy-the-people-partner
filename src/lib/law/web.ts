/*
 * Jessy on the open web, for what no article can answer: today's minimum wage, this year's
 * insurance ceiling, a decree newer than her copy of the law.
 *
 * Two routes, whichever has what it needs: Tavily with TAVILY_API_KEY, or Google Search through
 * Gemini, which refuses a free-tier key (429 on every model, measured 2026-11-03) and works on a
 * billed one. Neither configured means no web, and she says so rather than guessing.
 *
 * What comes back is DATA from strangers. ask-prompt.ts tells her the law outranks it, and the
 * page shows every address it came from. It never becomes a citation of the law.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

export type WebResult = { title: string; url: string; text: string };

const TIMEOUT_MS = 9_000;

/*
 * Questions the law's text cannot settle on its own: a figure that changes, a law other than
 * this one, or a person asking for the news. The word list is what triggers a search even when
 * the law has plenty to say about the neighbouring topic.
 */
const NEEDS_THE_WEB =
  /(الحد\s+الاد?ن[يى]|الحد\s+الأدن[يى]|حد\s+أدن[يى]|تامينات|تأمينات|التأمين\s+الصحي|ضريب|ضرائب|كسب\s+العمل|معاش|سن\s+المعاش|2026|2027|السنة\s+دي|السنه\s+دي|حالي[اًا]?|دلوقتي|آخر\s+(?:قرار|تعديل|زيادة)|اخر\s+(?:قرار|تعديل|زياده)|أحدث|احدث|تعديلات?|اللائحة\s+التنفيذية|استمار[ةه]\s*\d|كام\s+جنيه|منح[ةه]\s+(?:رمضان|العيد|الغلاء)|علاو[ةه]\s+الغلاء|زياد[ةه]\s+المرتبات|\bgoogle\b|\binternet\b|من\s+النت|على\s+النت|ابحث|دوري\s+على)/i;

/** How weak a best match has to be before the law's own text is taken not to cover the question. */
const THIN_MATCH = 5;

export function wantsWeb(question: string, bestScore: number): boolean {
  return NEEDS_THE_WEB.test(question) || bestScore < THIN_MATCH;
}

const addressOf = (url: string) => {
  try {
    return new URL(url).protocol === 'https:' || new URL(url).protocol === 'http:';
  } catch {
    return false;
  }
};

export async function searchTavily(key: string, query: string): Promise<WebResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_answer: false }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tavily answered ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (data.results ?? [])
    .filter((r) => r.url && addressOf(r.url) && r.content)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, text: r.content!.slice(0, 1400) }));
}

export async function searchGemini(key: string, model: string, query: string): Promise<WebResult[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `ابحث وقدم الحقائق والأرقام الحالية في مصر مع تاريخها: ${query}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`gemini search answered ${res.status}`);
  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] };
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
    }[];
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  // A summary with no address behind it is not a source, and is treated as no result at all.
  if (!text || chunks.length === 0) return [];
  return chunks
    .filter((c) => c.web?.uri && addressOf(c.web.uri))
    .slice(0, 5)
    .map((c, i) => ({ title: c.web!.title ?? c.web!.uri!, url: c.web!.uri!, text: i === 0 ? text.slice(0, 2400) : '' }));
}

/** What the open web says, or an empty list: a search that fails must not cost her the answer. */
export async function searchWeb(
  query: string,
  keys: { tavily?: string; gemini?: string; geminiModel?: string },
): Promise<{ results: WebResult[]; available: boolean }> {
  const available = !!keys.tavily || !!keys.gemini;
  const routes: (() => Promise<WebResult[]>)[] = [];
  if (keys.tavily) routes.push(() => searchTavily(keys.tavily!, query));
  if (keys.gemini) routes.push(() => searchGemini(keys.gemini!, keys.geminiModel ?? 'gemini-3.5-flash', query));
  for (const route of routes) {
    try {
      const results = await route();
      if (results.length) return { results, available: true };
    } catch (err) {
      console.warn(`[web] ${err instanceof Error ? err.message.slice(0, 200) : 'failed'}`);
    }
  }
  return { results: [], available };
}
