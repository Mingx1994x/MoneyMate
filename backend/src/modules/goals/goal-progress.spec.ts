import { Prisma } from '../../prisma/index.js';
import {
  averageMonthlySaving,
  buildMilestones,
  goalPercent,
  recentCompleteMonths,
} from './goal-progress.js';

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

/** 方便比對：金額轉成固定 2 位小數的字串 */
const amounts = (target: number, current = 0): string[] =>
  buildMilestones(D(target), D(current)).milestones.map((m) =>
    m.amount.toFixed(2),
  );

describe('buildMilestones：站的金額（PRD 15.4）', () => {
  it('AC-17：每月 5,000 → 目標 150 萬 → 10 萬、75 萬、100 萬、150 萬', () => {
    expect(amounts(1500000)).toEqual([
      '100000.00',
      '750000.00',
      '1000000.00',
      '1500000.00',
    ]);
  });

  it('每月 4 萬 → 目標 1,200 萬 → 10 萬、100 萬、600 萬、1,200 萬', () => {
    expect(amounts(12000000)).toEqual([
      '100000.00',
      '1000000.00',
      '6000000.00',
      '12000000.00',
    ]);
  });

  it('最小目標（每月 1,000 → 30 萬）：100 萬 ≥ 目標被刪掉 → 10 萬、15 萬、30 萬', () => {
    expect(amounts(300000)).toEqual(['100000.00', '150000.00', '300000.00']);
  });

  it('目標 ÷ 2 剛好是 100 萬（目標 200 萬）：重複的只留一個', () => {
    const { milestones } = buildMilestones(D(2000000), D(0));
    expect(milestones.map((m) => m.amount.toFixed(2))).toEqual([
      '100000.00',
      '1000000.00',
      '2000000.00',
    ]);
    // 留下先列的「第一桶金」
    expect(milestones[1].label).toBe('第一桶金');
  });

  it('目標 ÷ 2 剛好是 10 萬（目標 20 萬，低於問卷下限，只測規則）：重複的只留一個', () => {
    expect(amounts(200000)).toEqual(['100000.00', '200000.00']);
  });

  it('站名：緊急預備金、第一桶金、一半、財富自由；index 從 1 開始', () => {
    const { milestones } = buildMilestones(D(12000000), D(0));
    expect(milestones.map((m) => [m.index, m.label])).toEqual([
      [1, '緊急預備金'],
      [2, '第一桶金'],
      [3, '一半'],
      [4, '財富自由'],
    ]);
  });
});

describe('buildMilestones：已到的站與下一站', () => {
  it('AC-16：目標 1,200 萬、目前 25 萬 → 第 1 站已到，下一站是第 2 站「再存 750,000」', () => {
    const { milestones, next } = buildMilestones(D(12000000), D(250000));
    expect(milestones.map((m) => m.reached)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(next?.index).toBe(2);
    expect(next?.label).toBe('第一桶金');
    expect(next?.remaining.toFixed(2)).toBe('750000.00');
  });

  it('剛好等於站的金額也算到了', () => {
    const { milestones, next } = buildMilestones(D(12000000), D(100000));
    expect(milestones[0].reached).toBe(true);
    expect(next?.index).toBe(2);
  });

  it('目前 0 元（問卷剛完成）→ 下一站是第 1 站，再存 10 萬', () => {
    const { next } = buildMilestones(D(12000000), D(0));
    expect(next?.index).toBe(1);
    expect(next?.remaining.toFixed(2)).toBe('100000.00');
  });

  it('目前是負的（信用卡欠款）→ 再存的金額要把欠款算進去', () => {
    const { next } = buildMilestones(D(12000000), D('-50000.55'));
    expect(next?.index).toBe(1);
    expect(next?.remaining.toFixed(2)).toBe('150000.55');
  });

  it('全部達成 → 每站都 reached，下一站是 null', () => {
    const { milestones, next } = buildMilestones(D(12000000), D(12000000));
    expect(milestones.every((m) => m.reached)).toBe(true);
    expect(next).toBeNull();
  });

  it('不會改動傳進來的 Decimal', () => {
    const current = D(250000);
    buildMilestones(D(12000000), current);
    expect(current.toFixed(2)).toBe('250000.00');
  });
});

describe('goalPercent：達成百分比（PRD 15.3）', () => {
  it('AC-16：25 萬 ÷ 1,200 萬 ＝ 2.083…% → 2.1', () => {
    expect(goalPercent(D(12000000), D(250000))).toBe(2.1);
  });

  it('四捨五入到小數一位：0.05% 進位成 0.1，0.04% 捨去成 0', () => {
    expect(goalPercent(D(1000000), D(500))).toBe(0.1);
    expect(goalPercent(D(1000000), D(400))).toBe(0);
  });

  it('目前 0 或負的 → 0', () => {
    expect(goalPercent(D(12000000), D(0))).toBe(0);
    expect(goalPercent(D(12000000), D(-50000))).toBe(0);
  });

  it('≥ 目標 → 100（超過也是 100）', () => {
    expect(goalPercent(D(12000000), D(12000000))).toBe(100);
    expect(goalPercent(D(12000000), D(20000000))).toBe(100);
  });

  it('還沒達成但四捨五入會變 100（99.96%）→ 99.9，不顯示 100', () => {
    expect(goalPercent(D(1000000), D('999600'))).toBe(99.9);
  });
});

describe('recentCompleteMonths：最近的完整月（PRD 15.6、15.7）', () => {
  it('不含本月，由近到遠', () => {
    expect(recentCompleteMonths('2026-11-11', 6)).toEqual([
      '2026-10',
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
    ]);
  });

  it('月初第一天也不含本月；跨年', () => {
    expect(recentCompleteMonths('2026-02-01', 3)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
});

describe('averageMonthlySaving：每月平均儲蓄（PRD 15.7）', () => {
  const m = (income: number, expense: number) => ({
    income: D(income),
    expense: D(expense),
  });

  it('3 個有記帳的月 → 平均（收入 − 支出）', () => {
    expect(
      averageMonthlySaving([
        m(100000, 50000),
        m(90000, 60000),
        m(80000, 50000),
      ])?.toFixed(2),
    ).toBe('36666.67');
  });

  it('只有 2 個月有記帳 → null（改用自估值）', () => {
    expect(
      averageMonthlySaving([m(100000, 50000), m(0, 0), m(90000, 60000)]),
    ).toBeNull();
  });

  it('沒有記帳的月不算進平均（不當成存 0）', () => {
    expect(
      averageMonthlySaving([
        m(100000, 40000),
        m(0, 0),
        m(100000, 40000),
        m(0, 0),
        m(100000, 40000),
      ])?.toFixed(2),
    ).toBe('60000.00');
  });

  it('只有支出的月也算有記帳；平均可以是負的', () => {
    expect(
      averageMonthlySaving([m(0, 30000), m(0, 30000), m(0, 30000)])?.toFixed(2),
    ).toBe('-30000.00');
  });

  it('保留完整精度，不在這裡四捨五入', () => {
    expect(
      averageMonthlySaving([m(1, 0), m(1, 0), m(0, 1)])?.toString(),
    ).toMatch(/^0\.3333/);
  });

  it('空陣列 → null', () => {
    expect(averageMonthlySaving([])).toBeNull();
  });
});
