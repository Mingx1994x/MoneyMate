import { Prisma } from '../../prisma/index.js';
import { decideNextStep, formatTwd } from './next-step.js';

const d = (v: string | number) => new Prisma.Decimal(v);
const goal = {
  achieved: false,
  nextMilestone: { index: 2, remaining: d(760000) },
};

describe('decideNextStep（PRD 15.5）', () => {
  it('① 有逾期帳單：最優先，即使也有缺口與目標', () => {
    expect(
      decideNextStep({ overdueCount: 2, fundingGap: d(5000), goal }),
    ).toEqual({
      type: 'overdue_bills',
      message: '有 2 張帳單逾期',
      amount: null,
    });
  });

  it('② 沒有逾期、有資金缺口', () => {
    const step = decideNextStep({
      overdueCount: 0,
      fundingGap: d('15000.5'),
      goal,
    });
    expect(step.type).toBe('funding_gap');
    expect(step.message).toBe(
      '未來 14 天的已知帳單，整體資金可能不足，差 15,001 元',
    );
    expect(step.amount?.toFixed(2)).toBe('15000.50');
  });

  it('缺口是 0 不算缺口', () => {
    expect(
      decideNextStep({ overdueCount: 0, fundingGap: d(0), goal }).type,
    ).toBe('next_milestone');
  });

  it('③ 有目標：下一站（AC-16：再存 760,000 到第 2 站）', () => {
    const step = decideNextStep({ overdueCount: 0, fundingGap: null, goal });
    expect(step).toMatchObject({
      type: 'next_milestone',
      message: '再存 760,000 元就到第 2 站',
    });
    expect(step.amount?.toFixed(0)).toBe('760000');
  });

  it('③ 已達成目標', () => {
    expect(
      decideNextStep({
        overdueCount: 0,
        fundingGap: null,
        goal: { achieved: true, nextMilestone: null },
      }).type,
    ).toBe('goal_achieved');
  });

  it('④ 沒有目標：先完成問卷', () => {
    expect(
      decideNextStep({ overdueCount: 0, fundingGap: null, goal: null }),
    ).toEqual({
      type: 'onboarding',
      message: '先完成 30 秒問卷',
      amount: null,
    });
  });
});

describe('formatTwd', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [12000000, '12,000,000'],
    ['0.01', '1'],
    ['1234.5', '1,235'],
  ])('%s → %s', (v, expected) => {
    expect(formatTwd(d(v))).toBe(expected);
  });
});
