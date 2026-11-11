import { Prisma } from '../../prisma/index.js';
import {
  calcLoanPayment,
  countInstallments,
  loanSchedule,
} from './loan-payment.js';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('countInstallments（D-E-002）', () => {
  it.each([
    // 還款日 31
    ['2026-10-28', 31, '2031-09-30', 60, '10/31 到 2031/9/30'],
    ['2026-11-01', 31, '2031-09-30', 59, '10/31 已過，從 11/30 算'],
    ['2026-10-28', 31, '2026-09-30', 1, '結清日早於今天，至少 1'],
    // 還款日 5
    ['2026-10-21', 5, '2027-01-05', 3, '10/5 已過：11/5、12/5、1/5'],
    ['2026-10-05', 5, '2027-01-05', 4, '今天是還款日，算一期'],
    ['2026-10-28', 5, '2031-09-30', 59, '最後一期 9/5，跟結清日的日不同'],
    ['2026-10-28', 5, '2026-11-03', 1, '11/5 晚於結清日不算，0 期取至少 1'],
    // 還款日 10
    ['2026-12-20', 10, '2027-01-10', 1, '跨年'],
    // 短月
    ['2027-02-10', 31, '2027-04-30', 3, '2/28、3/31、4/30'],
    ['2027-02-28', 31, '2027-03-31', 2, '2/28 是今天，算一期'],
    ['2028-02-10', 30, '2028-03-30', 2, '閏年 2/29、3/30'],
    ['2026-10-28', 28, '2026-10-28', 1, '今天、還款日、結清日同一天'],
  ])('今天 %s、每月 %i 號、結清日 %s → %i 期（%s）', (today, day, end, n) => {
    expect(countInstallments(today, day, end)).toBe(n);
  });
});

describe('calcLoanPayment（PRD 15.8）', () => {
  it('PRD 驗算案例：1,000,000、3%、60 期 → 月付 17,969、第 60 期 17,949、總利息 78,120', () => {
    const input = {
      balance: D('1000000'),
      annualRatePercent: 3,
      installments: 60,
    };
    const { monthlyPayment, totalInterest } = calcLoanPayment(input);
    expect(monthlyPayment.toFixed(2)).toBe('17969.00');
    expect(totalInterest.toFixed(2)).toBe('78120.00');

    const schedule = loanSchedule(input);
    expect(schedule).toHaveLength(60);
    expect(schedule.slice(0, 59).every((r) => r.payment.eq(17969))).toBe(true);
    expect(schedule[59].payment.toFixed(2)).toBe('17949.00');
    expect(schedule[59].remaining.isZero()).toBe(true);
  });

  it('年利率 0%：月付 ＝ 餘額 ÷ n 四捨五入，總利息 0，最後一期吸收尾差', () => {
    const input = {
      balance: D('100000'),
      annualRatePercent: 0,
      installments: 7,
    };
    const { monthlyPayment, totalInterest } = calcLoanPayment(input);
    expect(monthlyPayment.toFixed(2)).toBe('14286.00');
    expect(totalInterest.toFixed(2)).toBe('0.00');
    const schedule = loanSchedule(input);
    expect(schedule[6].payment.toFixed(2)).toBe('14284.00');
    expect(schedule[6].remaining.isZero()).toBe(true);
  });

  it('n ＝ 1：月付 ＝ 餘額 ＋ 一期利息', () => {
    const { monthlyPayment, totalInterest } = calcLoanPayment({
      balance: D('100000'),
      annualRatePercent: 3,
      installments: 1,
    });
    expect(monthlyPayment.toFixed(2)).toBe('100250.00');
    expect(totalInterest.toFixed(2)).toBe('250.00');
  });

  it('n ＝ 1 而且餘額有角分：月付照實際金額，不取整到元', () => {
    expect(
      calcLoanPayment({
        balance: D('1000.50'),
        annualRatePercent: 0,
        installments: 1,
      }).monthlyPayment.toFixed(2),
    ).toBe('1000.50');
  });

  it.each([
    ['100000', 5, 7],
    ['1000000', 3, 60],
    ['317200.55', 2.125, 37],
    ['999999999999.99', 100, 600],
    // 月付取整後會比實際需要的多，提早還完；剩下的期數月付是 0
    ['100', 3, 60],
  ])(
    '尾差：%s 元、%s%%、%i 期，每期剩餘本金不為負，最後一期剛好歸 0',
    (balance, rate, n) => {
      const schedule = loanSchedule({
        balance: D(balance),
        annualRatePercent: rate,
        installments: n,
      });
      expect(schedule.every((r) => !r.remaining.isNegative())).toBe(true);
      expect(schedule.at(-1)?.remaining.isZero()).toBe(true);
      // 繳的總額 ＝ 本金 ＋ 總利息
      const paid = schedule.reduce((s, r) => s.plus(r.payment), D(0));
      const { totalInterest } = calcLoanPayment({
        balance: D(balance),
        annualRatePercent: rate,
        installments: n,
      });
      expect(paid.eq(D(balance).plus(totalInterest))).toBe(true);
    },
  );

  it('年利率可以有 3 位小數', () => {
    // 3.125% → r ＝ 0.0026041666…；只確認可以算、最後歸 0
    const schedule = loanSchedule({
      balance: D('500000'),
      annualRatePercent: 3.125,
      installments: 24,
    });
    expect(schedule.at(-1)?.remaining.isZero()).toBe(true);
  });

  it.each([
    ['期數 0', '1000', 0],
    ['期數不是整數', '1000', 1.5],
    ['餘額為負', '-1', 12],
  ])('%s 時丟錯（呼叫端的錯誤，不是使用者輸入）', (_label, balance, n) => {
    expect(() =>
      loanSchedule({
        balance: D(balance),
        annualRatePercent: 3,
        installments: n,
      }),
    ).toThrow(Error);
  });
});
