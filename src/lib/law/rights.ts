/*
 * The sums an employee actually wants: how much leave, what overtime comes to, how long the notice
 * runs, what is owed at the end. No model and no server, so the answer is the same every time and
 * no figure about anyone's pay leaves their phone.
 *
 * Every figure names the articles it stands on, and tests/rights.test.mjs reads those articles to
 * check they still say what is assumed here. Where the law leaves a gap the sum says so in `notes`
 * rather than quietly choosing: it never says how many days a month has, or how to count part of a
 * year. Each of those is marked as a practice and not as the text.
 *
 * This file imports nothing, so node runs it directly in tests/.
 */

/** The law does not define a month's days or the hours behind "the hourly wage", so these show on the form. */
export const DEFAULT_DAYS_IN_MONTH = 30;
export const DEFAULT_HOURS_IN_DAY = 8;

export type Cited = { articles: number[]; notes: string[] };

const money = (amount: number) => Math.round(amount * 100) / 100;
const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/* ------------------------------ Leave: articles 124 and 125 ------------------------------ */

export type LeaveInput = {
  /** Months with this employer. */
  serviceMonths: number;
  /** Full years with every employer, this one included. Blank means only this one. */
  allYears?: number | null;
  over50: boolean;
  disability: boolean;
  /** Dangerous or unhealthy work, or a remote area, as the minister's decree lists them. */
  hazardous: boolean;
  usedDays?: number | null;
  carriedDays?: number | null;
  monthlyWage?: number | null;
  daysInMonth?: number | null;
};

export type Leave = Cited & { annual: number; entitled: number; balance: number; pay: number | null };

export function leave(input: LeaveInput): Leave {
  const { serviceMonths: months, over50, disability, hazardous } = input;
  const allYears = Math.max(input.allYears ?? 0, Math.floor(months / 12));
  const articles = [124];
  const notes: string[] = [];

  let base = months >= 12 ? 21 : 15;
  if (allYears >= 10 || over50) base = 30;
  if (disability) base = 45;
  const annual = base + (hazardous ? 7 : 0);

  let entitled = annual;
  if (months < 6) {
    entitled = 0;
    notes.push('الإجازة السنوية بتبدأ لما تكمل 6 شهور في الخدمة.');
  } else if (months < 12) {
    entitled = money((annual / 12) * months);
    notes.push('أقل من سنة: الإجازة بنسبة المدة. الحساب بالشهور (الأيام ÷ 12 × الشهور) ممارسة عملية، النص مذكرش طريقة الحساب.');
  }

  const balance = Math.max(money(entitled + (input.carriedDays ?? 0) - (input.usedDays ?? 0)), 0);

  let pay: number | null = null;
  if (positive(input.monthlyWage)) {
    const days = positive(input.daysInMonth) ? input.daysInMonth : DEFAULT_DAYS_IN_MONTH;
    pay = money((input.monthlyWage / days) * balance);
    articles.push(125, 108);
    notes.push(
      `قيمة الرصيد بتتصرف لما علاقة العمل تنتهي، أو في تسوية الرصيد كل 3 سنين على الأكتر. الأجر محسوب على ${days} يوم في الشهر، والقانون محددش العدد.`,
      'لو رفضت كتابةً تاخد الإجازة في ميعادها، حقك في مقابلها بيسقط.',
    );
  }
  return { annual, entitled, balance, pay, articles, notes };
}

/* --------------------------------- Overtime: article 121 --------------------------------- */

export type OvertimeInput = {
  monthlyWage: number;
  daysInMonth?: number | null;
  hoursInDay?: number | null;
  dayHours?: number | null;
  nightHours?: number | null;
  restDays?: number | null;
};

export type Overtime = Cited & { hourly: number; dayPay: number; nightPay: number; restPay: number; total: number; daysOwed: number };

export function overtime(input: OvertimeInput): Overtime | null {
  if (!positive(input.monthlyWage)) return null;
  const days = positive(input.daysInMonth) ? input.daysInMonth : DEFAULT_DAYS_IN_MONTH;
  const hours = positive(input.hoursInDay) ? input.hoursInDay : DEFAULT_HOURS_IN_DAY;
  const daily = input.monthlyWage / days;
  const hourly = daily / hours;
  const dayPay = money(hourly * 1.35 * (input.dayHours ?? 0));
  const nightPay = money(hourly * 1.7 * (input.nightHours ?? 0));
  const daysOwed = input.restDays ?? 0;
  const restPay = money(daily * daysOwed);
  const notes = [
    `أجر الساعة محسوب على ${days} يوم في الشهر و${hours} ساعات في اليوم. القانون محددش طريقة حساب أجر الساعة، فغيّرهم لو عقدك بيقول غير كده.`,
    'الأرقام دي الحد الأدنى، والعقد ممكن يدي أكتر.',
    'وجودك في المنشأة مينفعش يزيد عن 12 ساعة في اليوم.',
  ];
  if (daysOwed > 0) notes.push('يوم الراحة ليه كمان يوم تاني بدله خلال الأسبوع اللي بعده، غير الفلوس.');
  return { hourly: money(hourly), dayPay, nightPay, restPay, total: money(dayPay + nightPay + restPay), daysOwed, articles: [121, 117], notes };
}

/* --------------------------------- Notice: articles 156-164 --------------------------------- */

export type NoticeInput = {
  contract: 'open' | 'fixed';
  by: 'employer' | 'worker';
  /** The day the written notice was received, as yyyy-mm-dd. */
  received?: string | null;
  /** Months of the notice already worked, if the employer ended it early. */
  servedMonths?: number | null;
  monthlyWage?: number | null;
};

export type Notice = Cited & { months: number; ends: string | null; owed: number | null };

const NOTICE_MONTHS = 3;

/** The same day some months on, or the last day of a shorter month. */
export function addMonths(date: string, months: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = new Date(Date.UTC(year, month - 1, day));
  if (start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) return null;
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function notice(input: NoticeInput): Notice {
  if (input.contract === 'fixed') {
    return {
      months: 0,
      ends: null,
      owed: null,
      articles: [154],
      notes: [
        'العقد محدد المدة بينتهي لوحده لما مدته تخلص، من غير مهلة إخطار.',
        'لو العقد أكتر من 5 سنين، تقدر تنهيه بعد 5 سنين بإخطار قبلها بـ 3 شهور، من غير تعويض.',
      ],
    };
  }
  const ends = input.received ? addMonths(input.received, NOTICE_MONTHS) : null;
  if (input.by === 'worker') {
    return {
      months: NOTICE_MONTHS,
      ends,
      owed: null,
      articles: [156, 158, 161, 167],
      notes: [
        'المهلة بتبدأ من يوم تسليم الإخطار.',
        'صاحب العمل بس هو اللي يقدر يعفيك من المهلة كلها أو جزء منها، والاتفاق على تقليلها مش جايز.',
        'الاستقالة لازم تكون مكتوبة وموقعة ومعتمدة من الجهة الإدارية، وجهة العمل قدامها 10 أيام تبت فيها.',
      ],
    };
  }
  const left = Math.max(NOTICE_MONTHS - (input.servedMonths ?? 0), 0);
  return {
    months: NOTICE_MONTHS,
    ends,
    owed: positive(input.monthlyWage) ? money(input.monthlyWage * left) : null,
    articles: [156, 158, 159, 161, 162, 163, 164],
    notes: [
      'المهلة بتبدأ من يوم تسليم الإخطار، ومينفعش يتبعتلك وانت في إجازة. الإجازة المرضية بتوقفها لحد ما تخلص.',
      'لو صاحب العمل مخطركش أو قطع المهلة، عليه يدفعلك أجر المدة الباقية، وبتتحسب ضمن مدة خدمتك.',
      'طول المهلة من حقك يوم كامل في الأسبوع أو 8 ساعات للبحث عن شغل، بأجر، وتبلغه قبلها بيوم.',
      'لو أعفاك من الشغل أثناء المهلة، بتاخد أجرها وخدمتك مستمرة لحد آخرها.',
    ],
  };
}

/* ------------------------------ The end of the job: 154, 165, 168, 172 ------------------------------ */

export type Ending = 'unlawful' | 'fixedOverFive' | 'afterSixty' | 'resigned';

export type EndingInput = { how: Ending; years: number; months?: number | null; monthlyWage: number };

export type EndingResult = Cited & { amount: number; atLeast: boolean };

export function ending(input: EndingInput): EndingResult | null {
  if (!positive(input.monthlyWage)) return null;
  const extraMonths = input.months ?? 0;
  const service = (input.years ?? 0) + extraMonths / 12;
  const notes: string[] = [];
  if (extraMonths > 0 && input.how !== 'resigned') {
    notes.push('الشهور الزيادة محسوبة بنسبتها من السنة. النص بيقول "عن كل سنة" ومذكرش الكسور، فده تقدير.');
  }
  const dues = 'ده غير رصيد إجازاتك وأجرك وباقي مستحقاتك، وبتتدفع خلال 7 أيام من يوم ما تطلبها.';

  switch (input.how) {
    case 'unlawful':
      return {
        amount: money(input.monthlyWage * 2 * service),
        atLeast: true,
        articles: [165, 168, 108, 1],
        notes: [
          'ده الحد الأدنى للتعويض لو صاحب العمل أنهى العقد غير محدد المدة بسبب غير مشروع، أو لو سبت الشغل عشان أخل بالتزام جوهري. المحكمة هي اللي بتحدد إذا كان السبب غير مشروع وقيمة التعويض.',
          ...notes,
          dues,
          'الأجر هنا كل اللي بتاخده عن شغلك زي ما عرفته المادة 1، مش الأساسي بس.',
        ],
      };
    case 'fixedOverFive':
      return {
        amount: money(input.monthlyWage * service),
        atLeast: false,
        articles: [154, 108, 1],
        notes: ['الحساب ده لعقد محدد المدة أكتر من 5 سنين، أنهاه صاحب العمل بعد الـ 5 سنين: أجر شهر عن كل سنة.', ...notes, dues],
      };
    case 'afterSixty': {
      const firstFive = Math.min(service, 5);
      const rest = Math.max(service - 5, 0);
      return {
        amount: money(input.monthlyWage * (firstFive / 2 + rest)),
        atLeast: false,
        articles: [172, 108],
        notes: [
          'الحساب ده لمدة شغلك بعد سن 60 بس، ولو ملكش عنها حقوق في تأمين الشيخوخة والعجز والوفاة: نص شهر عن كل سنة من أول 5 سنين، وشهر عن كل سنة بعدهم، على آخر أجر.',
          ...notes,
          dues,
        ],
      };
    }
    case 'resigned':
      return {
        amount: 0,
        atLeast: false,
        articles: [167, 125, 108],
        notes: ['نصوص الاستقالة مفيهاش تعويض. ليك رصيد إجازاتك وأجرك وباقي مستحقاتك، وبتتدفع خلال 7 أيام من يوم ما تطلبها.'],
      };
  }
}
