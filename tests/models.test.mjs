import assert from 'node:assert/strict';
import test from 'node:test';

import { geminiProvider } from '../src/lib/law/models.ts';

test('a reply in several parts comes back as one text, with no word broken in two', async (t) => {
  // Seen live on 4 Nov 2026: "نصيبك" reached the page as "نص" and "يبك" on two lines.
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'في الممارسة، نص' }, { text: 'يبك بيتحسب' }] } }] }),
  );
  const reply = await geminiProvider('key', 'gemini-3.5-flash').run('system', [{ role: 'user', content: 'سؤال' }]);
  assert.equal(reply, 'في الممارسة، نصيبك بيتحسب');
});
