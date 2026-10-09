# جيسي — Jessy The People Partner

A Q&A site about **leave under Egyptian labour law 14/2025**: annual, casual,
study and exam, public holidays, pilgrimage, sick leave, maternity, nursing and
child care. Arabic only.

## How it answers

1. **The knowledge base answers first** (`src/lib/kb-data.ts`). Every entry was
   written off the law's own text and names its article, so a reader can check
   any figure.
2. **A model is reached only for a question the knowledge base cannot place**,
   and only when `GEMINI_API_KEY` is set — Gemini's free tier.
3. **The model may not state a legal figure of its own.** `src/lib/ask-guard.ts`
   throws away any reply containing an article number, law number, count of
   days or months, or percentage that did not already appear in the
   conversation, and the knowledge base's own answer is sent instead.

Without an API key the site still works: the knowledge base covers the whole
leave chapter on its own.

## Run it

```
npm install
npm run dev
npm test          # the knowledge base's routing and the guard
```

## What is not finished

The talking face. `src/lib/talk/face-shader.ts` already carries landmarks
measured on Jessy's portrait, but they have not been tuned against a running
page, and the components that drive it are parked in `reference/to-adapt/` —
see the README there.

## Sources

Law 14/2025 (arts. 54–57 and 124–133) · Minister of Labour decree 294/2025
(the twelve paid public occasions) · decree 49/2026 (hazardous work, +7 days) ·
social insurance law 148/2019 (wage compensation during sickness) · child law
12/1996 art. 72 (referenced by art. 57).
