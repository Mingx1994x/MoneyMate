import { Prisma } from '../../prisma/index.js';
import { summarizeBillAlerts, type PendingBill } from './bill-alerts.js';

const TODAY = '2026-10-28';

let seq = 0;
function bill(overrides: Partial<PendingBill> = {}): PendingBill {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: `帳單 ${seq}`,
    amount: new Prisma.Decimal('1000.00'),
    dueDate: TODAY,
    accountId: '00000000-0000-4000-8000-0000000000aa',
    ...overrides,
  };
}

/** 只取名稱，方便比對順序 */
const names = (items: { name: string }[]) => items.map((b) => b.name);

describe('summarizeBillAlerts：逾期與 14 天內', () => {
  it('沒有待繳帳單：兩個清單都是空的，dueTotal 是 0', () => {
    const a = summarizeBillAlerts([], TODAY);
    expect(a).toMatchObject({
      overdue: [],
      overdueCount: 0,
      dueSoon: [],
      dueSoonCount: 0,
    });
    expect(a.dueTotal).toBeInstanceOf(Prisma.Decimal);
    expect(a.dueTotal.toFixed(2)).toBe('0.00');
  });

  it('手機費 10/25 到期、今天 10/28 還沒繳：列在逾期，daysUntilDue 是 −3（US-B10）', () => {
    const b = bill({ name: '手機費', dueDate: '2026-10-25' });
    const a = summarizeBillAlerts([b], TODAY);
    expect(a.overdue).toEqual([
      {
        id: b.id,
        name: '手機費',
        amount: b.amount,
        dueDate: '2026-10-25',
        accountId: b.accountId,
        daysUntilDue: -3,
      },
    ]);
    expect(a.overdueCount).toBe(1);
    expect(a.dueSoon).toEqual([]);
  });

  it.each([
    ['今天到期（第 0 天）：14 天內', '2026-10-28', 'dueSoon', 0],
    ['11/11 是第 14 天：14 天內（AC-25）', '2026-11-11', 'dueSoon', 14],
    ['11/12 是第 15 天：不列（AC-25）', '2026-11-12', null, null],
    ['昨天到期：逾期', '2026-10-27', 'overdue', -1],
    ['很久以前到期：照樣是逾期', '2025-01-01', 'overdue', -665],
  ] as const)('%s', (_name, dueDate, list, days) => {
    const a = summarizeBillAlerts([bill({ dueDate })], TODAY);
    const all = [...a.overdue, ...a.dueSoon];
    if (list === null) {
      expect(all).toEqual([]);
      return;
    }
    expect(a[list]).toHaveLength(1);
    expect(all).toHaveLength(1);
    expect(a[list][0]?.daysUntilDue).toBe(days);
  });

  it('跨月也照實際天數算：今天 12/25，1/8 是第 14 天', () => {
    const a = summarizeBillAlerts(
      [bill({ dueDate: '2027-01-08' }), bill({ dueDate: '2027-01-09' })],
      '2026-12-25',
    );
    expect(a.dueSoon.map((b) => b.daysUntilDue)).toEqual([14]);
  });
});

describe('summarizeBillAlerts：dueTotal', () => {
  it('14 天內的房租 15,000＋手機費 999 ＝ 15,999；第 15 天與逾期的不算入（US-B11、AC-25）', () => {
    const a = summarizeBillAlerts(
      [
        bill({ name: '房租', amount: new Prisma.Decimal('15000.00') }),
        bill({
          name: '手機費',
          amount: new Prisma.Decimal('999.00'),
          dueDate: '2026-11-11',
        }),
        bill({
          name: '第 15 天',
          amount: new Prisma.Decimal('50000.00'),
          dueDate: '2026-11-12',
        }),
        bill({
          name: '逾期',
          amount: new Prisma.Decimal('70000.00'),
          dueDate: '2026-10-25',
        }),
      ],
      TODAY,
    );
    expect(a.dueTotal.toFixed(2)).toBe('15999.00');
    expect(a.dueSoonCount).toBe(2);
    expect(a.overdueCount).toBe(1);
  });

  it('只有逾期帳單：dueTotal 是 0（US-B32 c）', () => {
    const a = summarizeBillAlerts(
      [bill({ dueDate: '2026-10-01', amount: new Prisma.Decimal('8000') })],
      TODAY,
    );
    expect(a.overdueCount).toBe(1);
    expect(a.dueTotal.toFixed(2)).toBe('0.00');
  });

  it('小數加總不失真', () => {
    const a = summarizeBillAlerts(
      [
        bill({ amount: new Prisma.Decimal('0.10') }),
        bill({ amount: new Prisma.Decimal('0.20') }),
        bill({ amount: new Prisma.Decimal('999999999999.99') }),
      ],
      TODAY,
    );
    expect(a.dueTotal.toFixed(2)).toBe('1000000000000.29');
  });
});

describe('summarizeBillAlerts：清單內容與排序', () => {
  it('手機費 10/25 逾期、房租今天到期、保險 11/5 到期：「今天要處理」可以由逾期＋第 0 天組合（US-B33）', () => {
    const a = summarizeBillAlerts(
      [
        bill({ name: '保險', dueDate: '2026-11-05' }),
        bill({ name: '房租', dueDate: TODAY }),
        bill({ name: '手機費', dueDate: '2026-10-25' }),
      ],
      TODAY,
    );
    expect(names(a.overdue)).toEqual(['手機費']);
    expect(names(a.dueSoon)).toEqual(['房租', '保險']);
    const todo = [
      ...a.overdue,
      ...a.dueSoon.filter((b) => b.daysUntilDue === 0),
    ];
    expect(names(todo)).toEqual(['手機費', '房租']);
  });

  it('兩個清單都回全部、不截斷，張數是總數（C 只顯示前 5 筆）', () => {
    const bills = Array.from({ length: 7 }, (_, i) =>
      bill({ dueDate: `2026-11-0${i + 1}` }),
    );
    const overdue = Array.from({ length: 6 }, (_, i) =>
      bill({ dueDate: `2026-10-1${i}` }),
    );
    const a = summarizeBillAlerts([...bills, ...overdue], TODAY);
    expect(a.dueSoon).toHaveLength(7);
    expect(a.dueSoonCount).toBe(7);
    expect(a.overdue).toHaveLength(6);
    expect(a.overdueCount).toBe(6);
  });

  it('依到期日由舊到新；同一天依名稱，名稱也相同依 id', () => {
    const sameA = bill({
      id: '00000000-0000-4000-8000-0000000000b2',
      name: '電費',
      dueDate: '2026-11-01',
    });
    const sameB = bill({
      id: '00000000-0000-4000-8000-0000000000b1',
      name: '電費',
      dueDate: '2026-11-01',
    });
    const a = summarizeBillAlerts(
      [
        bill({ name: 'B', dueDate: '2026-11-05' }),
        sameA,
        bill({ name: '水費', dueDate: '2026-11-01' }),
        bill({ name: 'A', dueDate: '2026-10-29' }),
        sameB,
        bill({ name: '逾期 2', dueDate: '2026-10-20' }),
        bill({ name: '逾期 1', dueDate: '2026-10-10' }),
      ],
      TODAY,
    );
    expect(names(a.overdue)).toEqual(['逾期 1', '逾期 2']);
    expect(a.dueSoon.map((b) => [b.name, b.id])).toEqual([
      ['A', expect.any(String)],
      ['水費', expect.any(String)],
      ['電費', sameB.id],
      ['電費', sameA.id],
      ['B', expect.any(String)],
    ]);
  });
});
