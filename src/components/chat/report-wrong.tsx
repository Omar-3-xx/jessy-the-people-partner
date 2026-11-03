'use client';

import { useState } from 'react';

import { postAsHuman } from '@/lib/human';

/*
 * "This answer is wrong." Nothing leaves until the person has read exactly what will be sent and
 * pressed send, because this is the one thing on the site that is kept (lib/law/reports.ts).
 */

const NOTE_LIMIT = 300;

type Step = 'closed' | 'confirm' | 'sending' | 'sent' | 'failed';

export function ReportWrong({ question, answer, articles }: { question: string; answer: string; articles: string[] }) {
  const [step, setStep] = useState<Step>('closed');
  const [note, setNote] = useState('');

  async function send() {
    setStep('sending');
    try {
      const res = await postAsHuman('/api/report', { question, answer, articles, note });
      setStep(res.ok ? 'sent' : 'failed');
    } catch {
      setStep('failed');
    }
  }

  if (step === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setStep('confirm')}
        className="rounded-md bg-white/85 px-2 py-0.5 text-[11px] text-ink/70 underline decoration-ink/25 underline-offset-4 backdrop-blur-sm transition hover:text-ink hover:decoration-gold"
      >
        الإجابة دي غلط؟
      </button>
    );
  }

  if (step === 'sent') {
    return (
      <p className="inline-block rounded-md bg-white/85 px-2 py-0.5 text-[11px] text-ink/70 backdrop-blur-sm" role="status">
        وصلت، شكرًا. هنراجعها.
      </p>
    );
  }

  return (
    <div className="surface w-full max-w-[94%] rounded-xl px-4 py-3 text-right text-xs leading-6">
      <p>هيتبعت سؤالك وإجابة جيسي والمواد اللي استندت عليها وملاحظتك، عشان نراجعها. مش هنعرف مين اللي بعت.</p>
      <p className="mt-1 font-semibold">متكتبش اسمك ولا أي بيانات شخصية.</p>
      <label className="mt-2 block">
        <span className="opacity-80">إيه الغلط؟ (لو حابب)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={NOTE_LIMIT}
          rows={2}
          className="mt-1 block w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 outline-none transition focus:border-ink/45"
        />
      </label>
      {step === 'failed' && (
        <p className="mt-1.5" role="alert">
          معرفتش أبعتها دلوقتي، جرب تاني كمان شوية.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => void send()}
          disabled={step === 'sending'}
          className="rounded-lg bg-ink px-4 py-1.5 font-semibold text-white transition disabled:opacity-35"
        >
          {step === 'sending' ? 'بيتبعت…' : 'ابعت'}
        </button>
        <button
          type="button"
          onClick={() => setStep('closed')}
          disabled={step === 'sending'}
          className="rounded-lg border border-black/15 bg-white px-4 py-1.5 transition hover:border-black/35"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}
