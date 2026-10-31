import { Prisma } from '../../prisma/index.js';
import {
  calculateFireAge,
  type FireAgeInput,
  REAL_RETURN_RATE,
} from './fire-age.js';

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);

/** 驗算案例（PRD 15.7）：40 歲、年支出 60 萬、年儲蓄 60 萬、現在資產 500 萬 */
const PRD_CASE: FireAgeInput = {
  annualSpending: D(600000),
  annualSaving: D(600000),
  currentAssets: D(5000000),
  age: 40,
};

describe('實質報酬率', () => {
  it('6% 報酬、2% 通膨 → 約 3.92%（1.06 ÷ 1.02 − 1）', () => {
    expect(REAL_RETURN_RATE.toDecimalPlaces(6).toString()).toBe('0.039216');
    // 不是名目報酬減通膨（4%）
    expect(REAL_RETURN_RATE.eq('0.04')).toBe(false);
  });
});

describe('calculateFireAge：PRD 驗算案例', () => {
  const result = calculateFireAge(PRD_CASE);

  it('FIRE 目標 1,500 萬，第 11 年達成 → 51 歲', () => {
    expect(result.target.toString()).toBe('15000000');
    expect(result.status).toBe('ok');
    expect(result.years).toBe(11);
    expect(result.age).toBe(51);
  });

  // 標準答案用獨立的高精度算式（Python Decimal，60 位）算出，進位到分
  it('每一年的年底資產都對（年儲蓄在年底投入，第 1 年的儲蓄不賺當年報酬）', () => {
    expect(result.yearly.map((v) => v.toFixed(2))).toEqual([
      '5796078.43',
      '6623375.62',
      '7483115.85',
      '8376571.37',
      '9305064.36',
      '10269968.85',
      '11272712.72',
      '12314779.89',
      '13397712.44',
      '14523112.92',
      '15692646.76',
    ]);
  });

  it('第 10 年還差一點（14,523,112.92 < 1,500 萬），所以不是 50 歲', () => {
    expect(result.yearly[9].lt(result.target)).toBe(true);
    expect(result.yearly[10].gte(result.target)).toBe(true);
  });

  it('目標和問卷一致：每月花費 4 萬 → 年支出 48 萬 → 1,200 萬（＝ 每月花費 × 300）', () => {
    const r = calculateFireAge({ ...PRD_CASE, annualSpending: D(40000 * 12) });
    expect(r.target.eq(D(40000).times(300))).toBe(true);
    expect(r.target.toString()).toBe('12000000');
  });
});

describe('calculateFireAge：已達成', () => {
  it('現在資產 ≥ 目標 → achieved，沒有年齡和模擬', () => {
    const r = calculateFireAge({ ...PRD_CASE, currentAssets: D(20000000) });
    expect(r).toMatchObject({
      status: 'achieved',
      age: null,
      years: null,
      yearly: [],
    });
  });

  it('剛好等於目標也算達成', () => {
    expect(
      calculateFireAge({ ...PRD_CASE, currentAssets: D(15000000) }).status,
    ).toBe('achieved');
  });

  it('沒有出生年、沒有儲蓄也能判斷已達成（不需要這兩項）', () => {
    const r = calculateFireAge({
      annualSpending: D(600000),
      annualSaving: null,
      currentAssets: D(15000000),
      age: null,
    });
    expect(r.status).toBe('achieved');
  });
});

describe('calculateFireAge：缺資料', () => {
  it('沒有出生年 → need_birth_year', () => {
    const r = calculateFireAge({ ...PRD_CASE, age: null });
    expect(r).toMatchObject({ status: 'need_birth_year', age: null });
    expect(r.yearly).toEqual([]);
  });

  it('沒有年儲蓄 → need_saving', () => {
    const r = calculateFireAge({ ...PRD_CASE, annualSaving: null });
    expect(r).toMatchObject({ status: 'need_saving', age: null });
  });

  it('兩個都沒有：先回 need_birth_year', () => {
    const r = calculateFireAge({ ...PRD_CASE, age: null, annualSaving: null });
    expect(r.status).toBe('need_birth_year');
  });

  it('年儲蓄是 0 不是缺資料：靠資產報酬還是會成長，40 歲、資產 500 萬 → 69 歲', () => {
    const r = calculateFireAge({ ...PRD_CASE, annualSaving: D(0) });
    expect(r).toMatchObject({ status: 'ok', years: 29, age: 69 });
  });
});

describe('calculateFireAge：永遠達不到', () => {
  it('儲蓄為負，資產報酬補不回來 → unreachable（資產 100 萬、每年少存 10 萬）', () => {
    // 100 萬 × 3.92% ＝ 39,216 < 100,000，資產只會越來越少
    const r = calculateFireAge({
      ...PRD_CASE,
      currentAssets: D(1000000),
      annualSaving: D(-100000),
    });
    expect(r).toMatchObject({ status: 'unreachable', age: null, years: null });
    expect(r.yearly).toHaveLength(1);
  });

  it('現在資產是負的（信用卡欠款），儲蓄 0 → unreachable（欠款還會越滾越大）', () => {
    const r = calculateFireAge({
      ...PRD_CASE,
      currentAssets: D(-100000),
      annualSaving: D(0),
    });
    expect(r.status).toBe('unreachable');
  });

  it('儲蓄為負但資產夠大、報酬補得回來 → 還是會成長，不是 unreachable', () => {
    // 1,000 萬 × 3.92% ＝ 392,157 > 100,000
    const r = calculateFireAge({
      ...PRD_CASE,
      currentAssets: D(10000000),
      annualSaving: D(-100000),
    });
    expect(r.status).toBe('ok');
    expect(r.years).toBeGreaterThan(0);
  });
});

describe('calculateFireAge：100 歲上限', () => {
  const NEAR_TARGET = { ...PRD_CASE, currentAssets: D(14000000) };

  it('剛好 100 歲達成 → ok（上限是「超過 100 歲」）', () => {
    // 1,400 萬 × 1.0392 ＋ 60 萬 ＝ 15,149,019.61
    const r = calculateFireAge({ ...NEAR_TARGET, age: 99 });
    expect(r).toMatchObject({ status: 'ok', years: 1, age: 100 });
    expect(r.yearly[0].toFixed(2)).toBe('15149019.61');
  });

  it('同樣的資產，儲蓄少一點、100 歲前差一點 → over_100', () => {
    // 1,400 萬 × 1.0392 ＋ 30 萬 ＝ 14,849,019.61 < 1,500 萬
    const r = calculateFireAge({
      ...NEAR_TARGET,
      annualSaving: D(300000),
      age: 99,
    });
    expect(r).toMatchObject({ status: 'over_100', age: null, years: null });
    expect(r.yearly.map((v) => v.toFixed(2))).toEqual(['14849019.61']);
  });

  it('90 歲、資產 10 萬、每年存 1 萬 → over_100', () => {
    const r = calculateFireAge({
      ...PRD_CASE,
      age: 90,
      currentAssets: D(100000),
      annualSaving: D(10000),
    });
    expect(r.status).toBe('over_100');
    expect(r.yearly).toHaveLength(10);
  });

  it('已經超過 100 歲而且沒達成 → over_100，不模擬', () => {
    const r = calculateFireAge({ ...PRD_CASE, age: 101 });
    expect(r).toMatchObject({ status: 'over_100', yearly: [] });
  });
});

describe('calculateFireAge：其他', () => {
  it('現在資產是負的、儲蓄夠多 → 仍可算出年齡（30 歲、−50 萬 → 49 歲）', () => {
    const r = calculateFireAge({
      ...PRD_CASE,
      age: 30,
      currentAssets: D(-500000),
    });
    expect(r).toMatchObject({ status: 'ok', age: 49, years: 19 });
  });

  it('不會改動傳進來的 Decimal', () => {
    const input = { ...PRD_CASE };
    calculateFireAge(input);
    expect(input.currentAssets.toString()).toBe('5000000');
    expect(input.annualSaving?.toString()).toBe('600000');
  });
});
