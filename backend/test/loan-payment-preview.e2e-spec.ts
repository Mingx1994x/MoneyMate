import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { createTestApp } from './utils/create-test-app.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

const TODAY = '2026-10-28';
// US-L1：100 萬、3%、每月 31 號、結清日 2031-09-30
const US_L1 = {
  outstandingBalance: '1000000.00',
  interestRate: '3',
  paymentDay: '31',
  endDate: '2031-09-30',
};

/** GET /loans/payment-preview（LOAN-3、LOAN-4、D-E-002）。只計算，不讀寫資料庫，所以不用清資料庫。 */
describe('貸款試算（e2e）', () => {
  let app: INestApplication<App>;
  let auth: string;
  const clock = FakeClock.onTaipeiDate(TODAY);

  const preview = (query: Record<string, string>) =>
    request(app.getHttpServer())
      .get('/api/v1/loans/payment-preview')
      .query(query)
      .set('Authorization', auth);

  beforeAll(async () => {
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    auth = await bearer(app);
  });

  beforeEach(() => {
    clock.setTaipeiDate(TODAY);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('US-L1：今天 10/28、每月 31 號到 2031/9/30 是 60 期，月付 17,969、總利息 78,120', async () => {
    const res = await preview(US_L1).expect(200);
    expect(res.body).toEqual({
      monthlyPayment: '17969.00',
      totalInterest: '78120.00',
      installments: 60,
    });
  });

  it('US-L1：本月還款日過了就從下個月算（11/1 → 59 期）', async () => {
    clock.setTaipeiDate('2026-11-01');
    const res = await preview(US_L1).expect(200);
    expect(res.body).toMatchObject({ installments: 59 });
  });

  it('期數用台北的今天：UTC 10/31 16:00 已是台北 11/1，10/31 不算一期', async () => {
    // 照 UTC 算的話今天是 10/31、剛好是還款日，會多算一期變成 3
    clock.set('2026-10-31T16:00:00Z');
    const res = await preview({ ...US_L1, endDate: '2026-12-31' }).expect(200);
    expect(res.body).toMatchObject({ installments: 2 });
  });

  it('US-L15：年利率 0% → 月付 ＝ 餘額 ÷ 期數，總利息 0', async () => {
    const res = await preview({
      outstandingBalance: '120000',
      interestRate: '0',
      paymentDay: '5',
      endDate: '2027-10-05',
    }).expect(200);
    expect(res.body).toEqual({
      monthlyPayment: '10000.00',
      totalInterest: '0.00',
      installments: 12,
    });
  });

  it.each([
    ['結清日在本月', '2026-10-31'],
    ['結清日早於今天', '2025-10-31'],
  ])(
    'US-L16：%s → 1 期，月付 ＝ 餘額 ＋ 一個月利息，不報錯',
    async (_label, endDate) => {
      const res = await preview({ ...US_L1, endDate }).expect(200);
      expect(res.body).toEqual({
        monthlyPayment: '1002500.00',
        totalInterest: '2500.00',
        installments: 1,
      });
    },
  );

  it('結清日剛好是今天加 50 年可以試算（Q12）', async () => {
    const res = await preview({ ...US_L1, endDate: '2076-10-28' }).expect(200);
    expect(res.body).toMatchObject({ installments: 600 });
  });

  it.each([
    [
      '結清日晚於今天加 50 年（Q12）',
      { endDate: '2076-10-29' },
      'VALIDATION_FAILED',
      'endDate',
    ],
    [
      'US-L15：餘額 0',
      { outstandingBalance: '0' },
      'AMOUNT_NOT_POSITIVE',
      'outstandingBalance',
    ],
    [
      '餘額超過 2 位小數',
      { outstandingBalance: '1000.123' },
      'AMOUNT_INVALID',
      'outstandingBalance',
    ],
    [
      'US-L15：年利率空字串不會被當成 0%',
      { interestRate: '' },
      'VALIDATION_FAILED',
      'interestRate',
    ],
    ['繳款日 0', { paymentDay: '0' }, 'VALIDATION_FAILED', 'paymentDay'],
    ['繳款日 32', { paymentDay: '32' }, 'VALIDATION_FAILED', 'paymentDay'],
    ['繳款日有小數', { paymentDay: '5.5' }, 'VALIDATION_FAILED', 'paymentDay'],
    ['結清日不存在', { endDate: '2031-02-30' }, 'VALIDATION_FAILED', 'endDate'],
  ])('%s → 400 %s', async (_label, patch, code, field) => {
    const res = await preview({ ...US_L1, ...patch }).expect(400);
    expect(res.body).toMatchObject({
      code,
      details: [expect.objectContaining({ field })],
    });
  });

  it('沒帶 paymentDay → 400 VALIDATION_FAILED（D-E-002 改成必填）', async () => {
    const { paymentDay: _p, ...rest } = US_L1;
    const res = await preview(rest).expect(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [expect.objectContaining({ field: 'paymentDay' })],
    });
  });

  it('US-L23：沒帶 token → 401 AUTH_UNAUTHENTICATED', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/loans/payment-preview')
      .query(US_L1)
      .expect(401);
    expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });
});
