import { LoanStatus, Prisma, type Loan } from '../../prisma/index.js';
import { toLoanResponse } from './loan-mapper.js';

const row: Loan = {
  id: '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10',
  userId: '00000000-0000-4000-8000-000000000001',
  name: '房貸',
  loanType: 'mortgage',
  outstandingBalance: new Prisma.Decimal('1000000'),
  monthlyPayment: new Prisma.Decimal('17969.5'),
  paymentDay: 31,
  // @db.Date 讀出來是 UTC 午夜
  endDate: new Date('2031-09-30T00:00:00Z'),
  interestRate: new Prisma.Decimal('3.000'),
  status: LoanStatus.active,
  balanceUpdatedAt: new Date('2026-10-24T02:30:00Z'),
  note: null,
  createdAt: new Date('2026-10-24T02:30:00Z'),
  updatedAt: new Date('2026-10-25T02:30:00Z'),
};

describe('toLoanResponse', () => {
  it('金額 2 位小數字串、利率是數字、日期是 YYYY-MM-DD、時間是 ISO；不放 userId', () => {
    expect(toLoanResponse(row)).toEqual({
      id: row.id,
      name: '房貸',
      loanType: 'mortgage',
      outstandingBalance: '1000000.00',
      monthlyPayment: '17969.50',
      paymentDay: 31,
      endDate: '2031-09-30',
      interestRate: 3,
      status: 'active',
      balanceUpdatedAt: '2026-10-24T02:30:00.000Z',
      note: null,
      createdAt: '2026-10-24T02:30:00.000Z',
      updatedAt: '2026-10-25T02:30:00.000Z',
    });
  });

  it('利率 3 位小數照樣是數字；沒填是 null', () => {
    expect(
      toLoanResponse({ ...row, interestRate: new Prisma.Decimal('2.125') })
        .interestRate,
    ).toBe(2.125);
    expect(toLoanResponse({ ...row, interestRate: null }).interestRate).toBe(
      null,
    );
  });

  it('loan_type 不在清單時丟錯（回 500），不把不認得的值傳給前端', () => {
    expect(() => toLoanResponse({ ...row, loanType: 'boat' })).toThrow(Error);
  });
});
