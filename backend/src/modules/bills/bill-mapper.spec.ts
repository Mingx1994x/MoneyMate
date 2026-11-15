import { toDbDate } from '../../common/date-only.js';
import {
  BillStatus,
  Prisma,
  Recurrence,
  type Bill,
} from '../../prisma/index.js';
import { toBillResponse } from './bill-mapper.js';

const TODAY = '2026-10-28';

function bill(overrides: Partial<Bill> = {}): Bill {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-0000000000ee',
    seriesId: '00000000-0000-4000-8000-0000000000ff',
    name: '房租',
    amount: new Prisma.Decimal('15000'),
    categoryId: '00000000-0000-4000-8000-0000000000cc',
    accountId: '00000000-0000-4000-8000-0000000000aa',
    dueDate: toDbDate('2026-11-01'),
    dueDay: 1,
    dueMonth: null,
    recurrence: Recurrence.monthly,
    status: BillStatus.pending,
    paidAmount: null,
    paidDate: null,
    note: null,
    createdAt: new Date('2026-10-27T02:30:00.000Z'),
    updatedAt: new Date('2026-10-27T03:00:00.000Z'),
    ...overrides,
  };
}

describe('toBillResponse', () => {
  it('待繳帳單：金額 2 位小數字串、日期 YYYY-MM-DD、不放 userId', () => {
    expect(toBillResponse(bill(), TODAY)).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      seriesId: '00000000-0000-4000-8000-0000000000ff',
      name: '房租',
      amount: '15000.00',
      categoryId: '00000000-0000-4000-8000-0000000000cc',
      accountId: '00000000-0000-4000-8000-0000000000aa',
      dueDate: '2026-11-01',
      dueDay: 1,
      dueMonth: null,
      recurrence: 'monthly',
      status: 'pending',
      paidAmount: null,
      paidDate: null,
      isOverdue: false,
      note: null,
      createdAt: '2026-10-27T02:30:00.000Z',
      updatedAt: '2026-10-27T03:00:00.000Z',
    });
  });

  it('已繳帳單：實繳金額與日期照實轉換', () => {
    const res = toBillResponse(
      bill({
        status: BillStatus.paid,
        paidAmount: new Prisma.Decimal('14800.5'),
        paidDate: toDbDate('2026-10-03'),
      }),
      TODAY,
    );
    expect(res).toMatchObject({
      status: 'paid',
      paidAmount: '14800.50',
      paidDate: '2026-10-03',
    });
  });

  it.each([
    ['待繳、到期日早於今天：逾期', BillStatus.pending, '2026-10-27', true],
    ['待繳、今天到期：還不算逾期', BillStatus.pending, TODAY, false],
    ['已繳、到期日早於今天：不算逾期', BillStatus.paid, '2026-10-01', false],
  ])('%s', (_name, status, dueDate, expected) => {
    const paid =
      status === BillStatus.paid
        ? {
            paidAmount: new Prisma.Decimal('15000'),
            paidDate: toDbDate(dueDate),
          }
        : {};
    expect(
      toBillResponse(
        bill({ status, dueDate: toDbDate(dueDate), ...paid }),
        TODAY,
      ).isOverdue,
    ).toBe(expected);
  });

  it('isOverdue 用傳進來的台北今天判斷：同一張 10/31 到期的帳單，台北 10/31 不逾期、11/1 逾期', () => {
    const b = bill({ dueDate: toDbDate('2026-10-31') });
    expect(toBillResponse(b, '2026-10-31').isOverdue).toBe(false);
    expect(toBillResponse(b, '2026-11-01').isOverdue).toBe(true);
  });
});
