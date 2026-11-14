import { Prisma } from '../../prisma/index.js';
import { summarizeLoans, type ActiveLoan } from './loan-summary.js';

const TODAY = '2026-10-28';

let seq = 0;
function loan(overrides: Partial<ActiveLoan> = {}): ActiveLoan {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: `貸款 ${seq}`,
    outstandingBalance: new Prisma.Decimal('100000.00'),
    monthlyPayment: new Prisma.Decimal('5000.00'),
    paymentDay: 5,
    endDate: '2031-09-30',
    ...overrides,
  };
}

/** 只取還款日與天數，方便比對 */
function dates(loans: ActiveLoan[], today = TODAY) {
  return summarizeLoans(loans, today).upcomingPayments.map((p) => [
    p.date,
    p.daysUntilDue,
  ]);
}

describe('summarizeLoans：未償餘額合計', () => {
  it('沒有貸款時是 0 筆、0 元、沒有還款日（US-L20 f）', () => {
    const s = summarizeLoans([], TODAY);
    expect(s.activeCount).toBe(0);
    expect(s.outstandingTotal.toFixed(2)).toBe('0.00');
    expect(s.upcomingPayments).toEqual([]);
  });

  it('加總每一筆的未償餘額，小數不失真（US-L19）', () => {
    const s = summarizeLoans(
      [
        loan({ outstandingBalance: new Prisma.Decimal('1000000.00') }),
        loan({ outstandingBalance: new Prisma.Decimal('320000.10') }),
        loan({ outstandingBalance: new Prisma.Decimal('0.20') }),
        loan({ outstandingBalance: new Prisma.Decimal('0') }),
      ],
      TODAY,
    );
    expect(s.activeCount).toBe(4);
    expect(s.outstandingTotal).toBeInstanceOf(Prisma.Decimal);
    expect(s.outstandingTotal.toFixed(2)).toBe('1320000.30');
  });

  it('還款日不在 14 天內的貸款，餘額照樣算進合計', () => {
    const s = summarizeLoans([loan({ paymentDay: 20 })], TODAY);
    expect(s.upcomingPayments).toEqual([]);
    expect(s.outstandingTotal.toFixed(2)).toBe('100000.00');
  });
});

describe('summarizeLoans：14 天內的還款日', () => {
  it('今天 10/28、每月 5 號 → 11/5，還有 8 天（US-L3）', () => {
    const l = loan({ paymentDay: 5 });
    expect(summarizeLoans([l], TODAY).upcomingPayments).toEqual([
      {
        loanId: l.id,
        name: l.name,
        date: '2026-11-05',
        monthlyPayment: l.monthlyPayment,
        daysUntilDue: 8,
      },
    ]);
  });

  it.each([
    ['每月 28 號：今天是第 0 天，列入（US-L20 a）', 28, [['2026-10-28', 0]]],
    [
      '每月 11 號：11/11 是第 14 天，列入（US-L20 b）',
      11,
      [['2026-11-11', 14]],
    ],
    ['每月 12 號：11/12 是第 15 天，不列（US-L20 c）', 12, []],
    ['每月 27 號：本月已過，下個月 11/27 超過 14 天，不列', 27, []],
  ])('%s', (_, paymentDay, expected) => {
    expect(dates([loan({ paymentDay })])).toEqual(expected);
  });

  it('11 月沒有 31 號：每月 31 號的貸款，還款日是 11/30（US-L4）', () => {
    expect(dates([loan({ paymentDay: 31 })], '2026-11-20')).toEqual([
      ['2026-11-30', 10],
    ]);
  });

  it('2 月：每月 30 號的貸款，還款日是 2/28；閏年是 2/29', () => {
    expect(dates([loan({ paymentDay: 30 })], '2026-02-20')).toEqual([
      ['2026-02-28', 8],
    ]);
    expect(dates([loan({ paymentDay: 30 })], '2028-02-20')).toEqual([
      ['2028-02-29', 9],
    ]);
  });

  it('今天 12/28、每月 5 號 → 隔年 1/5（跨年，US-L20 e）', () => {
    expect(dates([loan({ paymentDay: 5 })], '2026-12-28')).toEqual([
      ['2027-01-05', 8],
    ]);
  });

  it('同一筆貸款只列一次：月底到下個月初的範圍內，只有下個月的還款日', () => {
    expect(dates([loan({ paymentDay: 1 })], '2026-10-20')).toEqual([
      ['2026-11-01', 12],
    ]);
  });
});

describe('summarizeLoans：結清日（Q10）', () => {
  it('還款日晚於結清日的不列：結清日 11/3、每月 5 號（US-L20 d）', () => {
    expect(dates([loan({ paymentDay: 5, endDate: '2026-11-03' })])).toEqual([]);
  });

  it('還款日剛好是結清日時列入', () => {
    expect(dates([loan({ paymentDay: 5, endDate: '2026-11-05' })])).toEqual([
      ['2026-11-05', 8],
    ]);
  });

  it('結清日已過、還沒改成已結清：不列還款日，餘額仍算進合計', () => {
    const s = summarizeLoans(
      [loan({ paymentDay: 28, endDate: '2026-10-01' })],
      TODAY,
    );
    expect(s.upcomingPayments).toEqual([]);
    expect(s.activeCount).toBe(1);
    expect(s.outstandingTotal.toFixed(2)).toBe('100000.00');
  });
});

describe('summarizeLoans：排序', () => {
  it('依還款日由近到遠，同一天依名稱，再依 id（US-L20 g）', () => {
    const later = loan({ name: 'A 車貸', paymentDay: 5 });
    const sameDayB = loan({
      id: '00000000-0000-4000-8000-00000000000b',
      name: '房貸',
      paymentDay: 1,
    });
    const sameDayA = loan({
      id: '00000000-0000-4000-8000-00000000000a',
      name: '房貸',
      paymentDay: 1,
    });
    const first = loan({ name: 'Z 學貸', paymentDay: 1 });
    const today = '2026-10-25';
    const s = summarizeLoans([later, sameDayB, first, sameDayA], today);
    expect(s.upcomingPayments.map((p) => p.loanId)).toEqual([
      first.id,
      sameDayA.id,
      sameDayB.id,
      later.id,
    ]);
  });
});
