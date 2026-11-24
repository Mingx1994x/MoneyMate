import { Prisma } from '../../prisma/index.js';
import {
  calcFundingGap,
  calcSavingsRate,
  trendRange,
} from './dashboard.service.js';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('calcSavingsRate（PRD 15.2）', () => {
  it.each([
    [50000, 30000, 40],
    [50000, 110000, -120], // AC-22 的驗算案例
    [3, 1, 66.7], // 除不盡：最後一步才四捨五入到小數一位
    [3, 2, 33.3],
    [8, 1, 87.5],
  ])('收入 %s、支出 %s → %s%', (income, expense, rate) => {
    expect(calcSavingsRate(d(income), d(expense))).toBe(rate);
  });

  it('收入為 0：null（畫面顯示「—」）', () => {
    expect(calcSavingsRate(d(0), d(500))).toBeNull();
  });
});

describe('calcFundingGap（PRD 15.5、AC-25）', () => {
  const cash = (total: number, hasCashAccounts = true) => ({
    total: d(total),
    hasCashAccounts,
  });

  it('待繳 30,000、可用現金 20,000：缺 10,000', () => {
    expect(calcFundingGap(2, d(30000), cash(20000))?.toFixed(2)).toBe(
      '10000.00',
    );
  });

  it('現金夠付：null', () => {
    expect(calcFundingGap(2, d(30000), cash(30000))).toBeNull();
  });

  it('14 天內沒有待繳帳單：null', () => {
    expect(calcFundingGap(0, d(0), cash(-100))).toBeNull();
  });

  it('沒有現金／銀行帳戶：不計算缺口（AC-20）', () => {
    expect(calcFundingGap(1, d(30000), cash(0, false))).toBeNull();
  });
});

describe('trendRange（月收支趨勢的月份範圍，D-A-005）', () => {
  it.each<[string, number, string, string]>([
    ['2026-11-20', 6, '2026-05', '2026-10'],
    ['2026-11-01', 1, '2026-10', '2026-10'], // 月初：本月還沒過完，不算
    ['2026-11-30', 1, '2026-10', '2026-10'], // 月底：本月一樣不算
    ['2026-01-15', 1, '2025-12', '2025-12'], // 1 月：上個月在去年
    ['2026-01-01', 12, '2025-01', '2025-12'],
    ['2026-03-31', 2, '2026-01', '2026-02'], // 2 月只有 28 天
    ['2024-03-10', 1, '2024-02', '2024-02'], // 閏年 2 月
  ])('今天 %s、%s 個月 → %s～%s', (today, months, from, to) => {
    expect(trendRange(today, months)).toEqual({ from, to });
  });

  it.each([0, -1, 1.5])('月數 %s：程式錯誤，直接丟錯', (months) => {
    expect(() => trendRange('2026-11-20', months)).toThrow();
  });
});
