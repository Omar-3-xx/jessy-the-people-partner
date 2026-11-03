'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import {
  DEFAULT_DAYS_IN_MONTH,
  DEFAULT_HOURS_IN_DAY,
  ending,
  leave,
  notice,
  overtime,
  type Cited,
  type Ending,
} from '@/lib/law/rights';
import { DISCLAIMER } from '@/lib/law/share';
import { readAmount } from '@/lib/numbers';

/*
 * The fields are plain text boxes read by readAmount, because a number box refuses the Arabic
 * digits many phones type. A result appears as soon as there is enough to work it out.
 */

const pounds = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} جنيه`;
const days = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })} يوم`;

export function Calculators() {
  return (
    <div className="mt-8 space-y-12">
      <LeaveCalculator />
      <OvertimeCalculator />
      <NoticeCalculator />
      <EndingCalculator />
    </div>
  );
}

function LeaveCalculator() {
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [allYears, setAllYears] = useState('');
  const [over50, setOver50] = useState(false);
  const [disability, setDisability] = useState(false);
  const [hazardous, setHazardous] = useState(false);
  const [used, setUsed] = useState('');
  const [carried, setCarried] = useState('');
  const [wage, setWage] = useState('');
  const [monthDays, setMonthDays] = useState(String(DEFAULT_DAYS_IN_MONTH));

  const wholeYears = readAmount(years);
  const extra = readAmount(months);
  const known = wholeYears !== null || extra !== null;
  const result = known
    ? leave({
        serviceMonths: (wholeYears ?? 0) * 12 + (extra ?? 0),
        allYears: readAmount(allYears),
        over50,
        disability,
        hazardous,
        usedDays: readAmount(used),
        carriedDays: readAmount(carried),
        monthlyWage: readAmount(wage),
        daysInMonth: readAmount(monthDays),
      })
    : null;

  return (
    <Calculator title="رصيد الإجازة السنوية">
      <Row>
        <Field label="سنين خدمتك عند صاحب العمل ده" value={years} onChange={setYears} />
        <Field label="وكام شهر زيادة" value={months} onChange={setMonths} />
      </Row>
      <Field label="كل سنين خدمتك مع كل أصحاب العمل (لو أكتر)" value={allYears} onChange={setAllYears} />
      <Check label="سني أكتر من 50 سنة" checked={over50} onChange={setOver50} />
      <Check label="من الأشخاص ذوي الإعاقة أو الأقزام" checked={disability} onChange={setDisability} />
      <Check label="شغلي خطر أو مضر بالصحة أو في منطقة نائية" checked={hazardous} onChange={setHazardous} />
      <Row>
        <Field label="أخدت كام يوم السنة دي" value={used} onChange={setUsed} />
        <Field label="رصيد من سنين فاتت" value={carried} onChange={setCarried} />
      </Row>
      <Row>
        <Field label="أجرك الشهري (عشان قيمة الرصيد)" value={wage} onChange={setWage} />
        <Field label="أيام الشهر في الحساب" value={monthDays} onChange={setMonthDays} />
      </Row>
      {result && (
        <Result
          figure={days(result.balance)}
          caption="رصيدك دلوقتي"
          lines={[
            ['إجازتك في السنة', days(result.annual)],
            ['اللي استحقيته لحد دلوقتي', days(result.entitled)],
            ...(result.pay !== null ? ([['قيمة الرصيد لو اتصرف', pounds(result.pay)]] as [string, string][]) : []),
          ]}
          cited={result}
        />
      )}
    </Calculator>
  );
}

function OvertimeCalculator() {
  const [wage, setWage] = useState('');
  const [monthDays, setMonthDays] = useState(String(DEFAULT_DAYS_IN_MONTH));
  const [dayHours, setDayHours] = useState(String(DEFAULT_HOURS_IN_DAY));
  const [dayExtra, setDayExtra] = useState('');
  const [nightExtra, setNightExtra] = useState('');
  const [restDays, setRestDays] = useState('');

  const monthlyWage = readAmount(wage);
  const result =
    monthlyWage === null
      ? null
      : overtime({
          monthlyWage,
          daysInMonth: readAmount(monthDays),
          hoursInDay: readAmount(dayHours),
          dayHours: readAmount(dayExtra),
          nightHours: readAmount(nightExtra),
          restDays: readAmount(restDays),
        });

  return (
    <Calculator title="الأوفر تايم">
      <Field label="أجرك الشهري" value={wage} onChange={setWage} />
      <Row>
        <Field label="أيام الشهر في الحساب" value={monthDays} onChange={setMonthDays} />
        <Field label="ساعات اليوم في الحساب" value={dayHours} onChange={setDayHours} />
      </Row>
      <Row>
        <Field label="ساعات إضافية بالنهار" value={dayExtra} onChange={setDayExtra} />
        <Field label="ساعات إضافية بالليل" value={nightExtra} onChange={setNightExtra} />
      </Row>
      <Field label="أيام اشتغلتها في يوم راحتك" value={restDays} onChange={setRestDays} />
      {result && (
        <Result
          figure={pounds(result.total)}
          caption="على الأقل"
          lines={[
            ['أجر ساعتك', pounds(result.hourly)],
            ['الساعات النهارية (35% زيادة)', pounds(result.dayPay)],
            ['الساعات الليلية (70% زيادة)', pounds(result.nightPay)],
            ['أيام الراحة', pounds(result.restPay)],
          ]}
          cited={result}
        />
      )}
    </Calculator>
  );
}

function NoticeCalculator() {
  const [contract, setContract] = useState<'open' | 'fixed'>('open');
  const [by, setBy] = useState<'employer' | 'worker'>('employer');
  const [received, setReceived] = useState('');
  const [served, setServed] = useState('');
  const [wage, setWage] = useState('');

  const result = notice({ contract, by, received, servedMonths: readAmount(served), monthlyWage: readAmount(wage) });

  return (
    <Calculator title="مهلة الإخطار">
      <Choice
        label="نوع العقد"
        value={contract}
        onChange={setContract}
        options={[
          ['open', 'غير محدد المدة'],
          ['fixed', 'محدد المدة'],
        ]}
      />
      {contract === 'open' && (
        <>
          <Choice
            label="مين اللي بينهي العقد"
            value={by}
            onChange={setBy}
            options={[
              ['employer', 'صاحب العمل'],
              ['worker', 'أنا'],
            ]}
          />
          <label className="block text-sm">
            <span className="opacity-85">يوم تسليم الإخطار</span>
            <input
              type="date"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              className="mt-1 block h-11 w-full rounded-xl border border-black/15 bg-white px-3 outline-none transition focus:border-ink/45"
            />
          </label>
          {by === 'employer' && (
            <Row>
              <Field label="اشتغلت كام شهر من المهلة" value={served} onChange={setServed} />
              <Field label="أجرك الشهري" value={wage} onChange={setWage} />
            </Row>
          )}
        </>
      )}
      <Result
        figure={result.months ? `${result.months} شهور` : 'مفيش مهلة'}
        caption={result.ends ? `بتخلص يوم ${result.ends}` : 'مهلة الإخطار'}
        lines={result.owed !== null ? [['لو اتقطعت، أجر الباقي منها', pounds(result.owed)]] : []}
        cited={result}
      />
    </Calculator>
  );
}

const ENDINGS: [Ending, string][] = [
  ['unlawful', 'صاحب العمل أنهى العقد بسبب غير مشروع، أو سبت بسبب إخلاله'],
  ['fixedOverFive', 'عقد محدد المدة أكتر من 5 سنين وأنهاه صاحب العمل'],
  ['afterSixty', 'شغل بعد سن 60 من غير حقوق تأمينية عن المدة دي'],
  ['resigned', 'استقلت'],
];

function EndingCalculator() {
  const [how, setHow] = useState<Ending>('unlawful');
  const [years, setYears] = useState('');
  const [months, setMonths] = useState('');
  const [wage, setWage] = useState('');

  const monthlyWage = readAmount(wage);
  const result =
    monthlyWage === null
      ? null
      : ending({ how, years: readAmount(years) ?? 0, months: readAmount(months), monthlyWage });

  return (
    <Calculator title="مستحقات نهاية الخدمة">
      <Choice label="الشغل انتهى إزاي" value={how} onChange={setHow} options={ENDINGS} stacked />
      <Row>
        <Field label="كام سنة" value={years} onChange={setYears} />
        <Field label="وكام شهر" value={months} onChange={setMonths} />
      </Row>
      <Field label="أجرك الشهري (كل اللي بتاخده، مش الأساسي بس)" value={wage} onChange={setWage} />
      {result && (
        <Result
          figure={result.amount ? pounds(result.amount) : 'مفيش تعويض'}
          caption={result.atLeast ? 'على الأقل' : 'تقدير'}
          lines={[]}
          cited={result}
        />
      )}
    </Calculator>
  );
}

function Calculator({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold">{title}</h2>
      <span aria-hidden className="mt-2.5 block h-px w-8 rounded-full bg-gold/60" />
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const wrong = value.trim() !== '' && readAmount(value) === null;
  return (
    <label className="block text-sm">
      <span className="opacity-85">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-invalid={wrong}
        className={`mt-1 block h-11 w-full rounded-xl border bg-white px-3 tabular-nums outline-none transition focus:border-ink/45 ${
          wrong ? 'border-ink' : 'border-black/15'
        }`}
      />
      {wrong && <span className="mt-0.5 block text-xs font-semibold">اكتب رقم بس.</span>}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[#1b2a4a]" />
      <span>{label}</span>
    </label>
  );
}

function Choice<T extends string>({
  label,
  value,
  onChange,
  options,
  stacked,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: [T, string][];
  stacked?: boolean;
}) {
  return (
    <fieldset className="text-sm">
      <legend className="opacity-85">{label}</legend>
      <div className={`mt-1.5 flex gap-x-5 gap-y-1.5 ${stacked ? 'flex-col' : 'flex-wrap'}`}>
        {options.map(([id, name]) => (
          <label key={id} className="flex items-center gap-2">
            <input type="radio" checked={value === id} onChange={() => onChange(id)} className="h-4 w-4 accent-[#1b2a4a]" />
            <span>{name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The figure, what it is made of, every condition on it, the articles, and the line every answer carries. */
function Result({ figure, caption, lines, cited }: { figure: string; caption: string; lines: [string, string][]; cited: Cited }) {
  return (
    <div className="surface rounded-2xl border-s-[3px] border-s-gold p-5" aria-live="polite">
      <p className="text-xs opacity-70">{caption}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums">{figure}</p>

      {lines.length > 0 && (
        <dl className="mt-3 text-sm">
          {lines.map(([name, value]) => (
            <div key={name} className="flex items-baseline justify-between gap-4 border-t border-black/10 py-1.5">
              <dt className="opacity-85">{name}</dt>
              <dd className="shrink-0 font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {cited.notes.length > 0 && (
        <ul className="answer mt-3 space-y-1.5 text-[13px] opacity-90">
          {cited.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
        {cited.articles.map((article) => (
          <Link key={article} href={`/law/${article}`} className="underline decoration-gold underline-offset-4">
            المادة {article}
          </Link>
        ))}
      </p>

      <p className="mt-3 border-t border-black/10 pt-2 text-[11px] opacity-75">{DISCLAIMER}</p>
    </div>
  );
}
