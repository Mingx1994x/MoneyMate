import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { toDbDate } from '../src/common/date-only.js';
import {
  AccountType,
  CategoryType,
  Prisma,
  PrismaService,
  TransactionType,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  createCategory,
  createTransaction,
  createUser,
  resetDb,
} from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

const TODAY = '2026-10-28';
/** FakeClock.onTaipeiDate(TODAY) 的時間點（台北 12:00） */
const TODAY_NOW = '2026-10-28T04:00:00.000Z';
const NOT_EXIST = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

// US-L1：100 萬、3%、每月 31 號、結清日 2031-09-30，月付用試算的 17,969
const BODY = {
  name: '房貸',
  loanType: 'mortgage',
  outstandingBalance: '1000000.00',
  monthlyPayment: '17969.00',
  paymentDay: 31,
  endDate: '2031-09-30',
  interestRate: 3,
  note: '每月 31 日自動扣款',
};

interface LoanBody {
  id: string;
  name: string;
  loanType: string;
  outstandingBalance: string;
  monthlyPayment: string;
  paymentDay: number;
  endDate: string;
  interestRate: number | null;
  status: string;
  balanceUpdatedAt: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 前端修改時送整份 body：回應裡可以改的欄位（不含 id 與時間） */
function editable(loan: LoanBody) {
  const {
    id: _id,
    balanceUpdatedAt: _b,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = loan;
  return rest;
}

/** 貸款 API（LOAN-2）。試算在 loan-payment-preview.e2e-spec.ts，getLoanSummary 在 loan-summary.e2e-spec.ts */
describe('貸款 API（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;
  const clock = FakeClock.onTaipeiDate(TODAY);

  const api = () => request(app.getHttpServer());
  const post = (body: object, token = auth) =>
    api().post('/api/v1/loans').set('Authorization', token).send(body);
  const get = (id: string, token = auth) =>
    api().get(`/api/v1/loans/${id}`).set('Authorization', token);
  const patch = (id: string, body: object, token = auth) =>
    api().patch(`/api/v1/loans/${id}`).set('Authorization', token).send(body);
  const del = (id: string, token = auth) =>
    api().delete(`/api/v1/loans/${id}`).set('Authorization', token);
  const create = async (body: object = BODY): Promise<LoanBody> =>
    (await post(body).expect(201)).body as LoanBody;
  const expectError = (res: request.Response, code: string, field?: string) => {
    expect(res.body).toMatchObject({
      code,
      details: field === undefined ? [] : [expect.objectContaining({ field })],
    });
  };

  beforeAll(async () => {
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.setTaipeiDate(TODAY);
    await resetDb(prisma);
    userId = await createUser(prisma, 'e-loans@example.com');
    auth = await bearer(app, userId);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /loans', () => {
    it('US-L1：帶試算的月付新增，GET 讀回同樣的值；不回 userId', async () => {
      const preview = await api()
        .get('/api/v1/loans/payment-preview')
        .query({
          outstandingBalance: BODY.outstandingBalance,
          interestRate: '3',
          paymentDay: '31',
          endDate: BODY.endDate,
        })
        .set('Authorization', auth)
        .expect(200);
      expect(preview.body).toMatchObject({ monthlyPayment: '17969.00' });

      const loan = await create();
      expect(loan).toEqual({
        id: expect.any(String) as unknown,
        name: '房貸',
        loanType: 'mortgage',
        outstandingBalance: '1000000.00',
        monthlyPayment: '17969.00',
        paymentDay: 31,
        endDate: '2031-09-30',
        interestRate: 3,
        status: 'active',
        balanceUpdatedAt: TODAY_NOW,
        note: '每月 31 日自動扣款',
        createdAt: expect.any(String) as unknown,
        updatedAt: expect.any(String) as unknown,
      });
      expect((await get(loan.id).expect(200)).body).toEqual(loan);
    });

    it('US-L1（備援）：沒帶月付但有年利率 → 用試算的公式算好存入', async () => {
      const { monthlyPayment: _m, ...body } = BODY;
      expect(await create(body)).toMatchObject({ monthlyPayment: '17969.00' });
    });

    it('US-L16：結清日在本月、沒帶月付 → 1 期，月付 ＝ 餘額 ＋ 一個月利息', async () => {
      const { monthlyPayment: _m, ...body } = BODY;
      expect(await create({ ...body, endDate: '2026-10-31' })).toMatchObject({
        monthlyPayment: '1002500.00',
      });
    });

    it('US-L2：沒年利率也沒月付 → 400 LOAN_MONTHLY_PAYMENT_REQUIRED；帶月付就成功，interestRate 是 null', async () => {
      const { monthlyPayment: _m, interestRate: _i, ...body } = BODY;
      expectError(
        await post(body).expect(400),
        'LOAN_MONTHLY_PAYMENT_REQUIRED',
        'monthlyPayment',
      );
      expectError(
        await post({ ...body, interestRate: null }).expect(400),
        'LOAN_MONTHLY_PAYMENT_REQUIRED',
        'monthlyPayment',
      );
      expect(
        await create({ ...body, monthlyPayment: '18500.00' }),
      ).toMatchObject({ monthlyPayment: '18500.00', interestRate: null });
    });

    it('未償餘額 0、沒帶月付 → 算不出大於 0 的月付，400 LOAN_MONTHLY_PAYMENT_REQUIRED', async () => {
      const { monthlyPayment: _m, ...body } = BODY;
      expectError(
        await post({ ...body, outstandingBalance: '0' }).expect(400),
        'LOAN_MONTHLY_PAYMENT_REQUIRED',
        'monthlyPayment',
      );
    });

    it('US-L13：月付大於未償餘額也照存', async () => {
      expect(
        await create({
          ...BODY,
          outstandingBalance: '10000',
          monthlyPayment: '20000',
        }),
      ).toMatchObject({
        outstandingBalance: '10000.00',
        monthlyPayment: '20000.00',
      });
    });

    it('US-L8、L18：已結清＋結清日已過＋餘額不是 0 → 成功（D-E-003）', async () => {
      expect(
        await create({
          ...BODY,
          status: 'closed',
          endDate: '2026-09-30',
          outstandingBalance: '320000',
        }),
      ).toMatchObject({
        status: 'closed',
        endDate: '2026-09-30',
        outstandingBalance: '320000.00',
      });
    });

    it('US-L16：active 而且結清日早於今天 → 400 LOAN_END_DATE_IN_PAST；今天當天可以', async () => {
      expectError(
        await post({ ...BODY, endDate: '2026-10-27' }).expect(400),
        'LOAN_END_DATE_IN_PAST',
        'endDate',
      );
      await create({ ...BODY, endDate: TODAY });
    });

    it('Q12：結清日剛好是今天加 50 年可以；晚一天回 400 VALIDATION_FAILED（endDate）', async () => {
      await create({ ...BODY, endDate: '2076-10-28' });
      expectError(
        await post({ ...BODY, endDate: '2076-10-29' }).expect(400),
        'VALIDATION_FAILED',
        'endDate',
      );
    });

    it('備註空字串存成 null；沒帶 status 是 active', async () => {
      const { note: _n, ...body } = BODY;
      expect(await create({ ...body, note: '  ' })).toMatchObject({
        note: null,
        status: 'active',
      });
    });

    it.each([
      [
        '月付 0',
        { monthlyPayment: '0' },
        'AMOUNT_NOT_POSITIVE',
        'monthlyPayment',
      ],
      [
        '未償餘額為負',
        { outstandingBalance: '-1' },
        'AMOUNT_NEGATIVE',
        'outstandingBalance',
      ],
      [
        '金額送 JSON 數字',
        { outstandingBalance: 1000000 },
        'AMOUNT_INVALID',
        'outstandingBalance',
      ],
      [
        '金額 3 位小數',
        { monthlyPayment: '17969.001' },
        'AMOUNT_INVALID',
        'monthlyPayment',
      ],
      [
        '繳款日 32（US-L9）',
        { paymentDay: 32 },
        'VALIDATION_FAILED',
        'paymentDay',
      ],
      [
        '繳款日 0（US-L9）',
        { paymentDay: 0 },
        'VALIDATION_FAILED',
        'paymentDay',
      ],
      ['名稱只有空白', { name: '   ' }, 'NAME_INVALID', 'name'],
      ['名稱 31 字', { name: '房'.repeat(31) }, 'NAME_INVALID', 'name'],
      ['類型不在清單', { loanType: 'boat' }, 'VALIDATION_FAILED', 'loanType'],
      [
        '年利率 100.001',
        { interestRate: 100.001 },
        'VALIDATION_FAILED',
        'interestRate',
      ],
      [
        '年利率 4 位小數',
        { interestRate: 3.1234 },
        'VALIDATION_FAILED',
        'interestRate',
      ],
      ['備註 201 字', { note: '備'.repeat(201) }, 'VALIDATION_FAILED', 'note'],
      [
        '結清日不存在',
        { endDate: '2031-02-30' },
        'VALIDATION_FAILED',
        'endDate',
      ],
      ['帶 userId', { userId: NOT_EXIST }, 'VALIDATION_FAILED', 'userId'],
      [
        '帶 balanceUpdatedAt',
        { balanceUpdatedAt: TODAY_NOW },
        'VALIDATION_FAILED',
        'balanceUpdatedAt',
      ],
    ])('US-L22：%s → 400 %s', async (_label, patchBody, code, field) => {
      expectError(
        await post({ ...BODY, ...patchBody }).expect(400),
        code,
        field,
      );
    });
  });

  describe('GET /loans', () => {
    it('沒有貸款時回 { items: [] }', async () => {
      expect(
        (
          await api()
            .get('/api/v1/loans')
            .set('Authorization', auth)
            .expect(200)
        ).body,
      ).toEqual({ items: [] });
    });

    it('US-L11：active 在前，同組依新增時間由新到舊；已結清也列出；別人的貸款不出現', async () => {
      await create({ ...BODY, name: '房貸' });
      await create({
        ...BODY,
        name: '學貸',
        status: 'closed',
        endDate: '2026-06-30',
      });
      await create({ ...BODY, name: '車貸' });
      const other = await createUser(prisma, 'e-loans-other@example.com');
      await post({ ...BODY, name: '別人的' }, await bearer(app, other)).expect(
        201,
      );

      const res = await api()
        .get('/api/v1/loans')
        .set('Authorization', auth)
        .expect(200);
      const items = (res.body as { items: LoanBody[] }).items;
      expect(items.map((l) => [l.name, l.status])).toEqual([
        ['車貸', 'active'],
        ['房貸', 'active'],
        ['學貸', 'closed'],
      ]);
    });
  });

  describe('PATCH /loans/:id', () => {
    it('US-L5、L21：改餘額 → balanceUpdatedAt 變成現在、月付不變', async () => {
      const loan = await create({ ...BODY, outstandingBalance: '320000' });
      clock.set('2026-11-05T01:00:00Z');
      const res = await patch(loan.id, { outstandingBalance: '317200' }).expect(
        200,
      );
      expect(res.body).toMatchObject({
        outstandingBalance: '317200.00',
        monthlyPayment: '17969.00',
        balanceUpdatedAt: '2026-11-05T01:00:00.000Z',
      });
    });

    it.each([
      ['只改備註', () => ({ note: '改備註' })],
      ['帶同樣的餘額（寫法不同）', () => ({ outstandingBalance: '320000.00' })],
      [
        '整份送出、餘額沒改',
        (l: LoanBody) => ({ ...editable(l), note: '整份' }),
      ],
    ])(
      'US-L21、Q11：%s → balanceUpdatedAt 不變',
      async (_label, makeBody: (l: LoanBody) => object) => {
        const loan = await create({ ...BODY, outstandingBalance: '320000' });
        clock.set('2026-11-05T01:00:00Z');
        const res = await patch(loan.id, makeBody(loan)).expect(200);
        expect(res.body).toMatchObject({ balanceUpdatedAt: TODAY_NOW });
      },
    );

    it('US-L13、D-E-001：改餘額、年利率、結清日但不帶月付 → 月付不變', async () => {
      const loan = await create({ ...BODY, monthlyPayment: '18500' });
      const res = await patch(loan.id, {
        outstandingBalance: '900000',
        interestRate: 2.5,
        endDate: '2030-12-31',
      }).expect(200);
      expect(res.body).toMatchObject({
        outstandingBalance: '900000.00',
        interestRate: 2.5,
        endDate: '2030-12-31',
        monthlyPayment: '18500.00',
      });
    });

    it('US-L12：{} 不變；note、interestRate 傳 null 清空，月付不變', async () => {
      const loan = await create();
      const same = (await patch(loan.id, {}).expect(200)).body as LoanBody;
      expect(editable(same)).toEqual(editable(loan));

      expect(
        (await patch(loan.id, { note: null }).expect(200)).body,
      ).toMatchObject({ note: null });
      expect(
        (await patch(loan.id, { interestRate: null }).expect(200)).body,
      ).toMatchObject({ interestRate: null, monthlyPayment: '17969.00' });
    });

    it.each([
      ['name', 'NAME_INVALID'],
      ['monthlyPayment', 'AMOUNT_INVALID'],
      ['outstandingBalance', 'AMOUNT_INVALID'],
      ['status', 'VALIDATION_FAILED'],
      ['endDate', 'VALIDATION_FAILED'],
      ['paymentDay', 'VALIDATION_FAILED'],
    ])('US-L12：%s 傳 null → 400 %s', async (field, code) => {
      const loan = await create();
      expectError(
        await patch(loan.id, { [field]: null }).expect(400),
        code,
        field,
      );
    });

    it('US-L8：還清後改成已結清、餘額改成 0 → 成功，balanceUpdatedAt 更新', async () => {
      const loan = await create({ ...BODY, outstandingBalance: '320000' });
      clock.set('2026-11-05T01:00:00Z');
      expect(
        (
          await patch(loan.id, {
            status: 'closed',
            outstandingBalance: '0',
          }).expect(200)
        ).body,
      ).toMatchObject({
        status: 'closed',
        outstandingBalance: '0.00',
        balanceUpdatedAt: '2026-11-05T01:00:00.000Z',
      });
    });

    it('US-L18、D-E-003：改成已結清但忘了改餘額 → 成功，餘額與 balanceUpdatedAt 都不變；改回 active 時原本的餘額還在', async () => {
      const loan = await create({ ...BODY, outstandingBalance: '320000' });
      clock.set('2026-11-05T01:00:00Z');
      expect(
        (await patch(loan.id, { status: 'closed' }).expect(200)).body,
      ).toMatchObject({
        status: 'closed',
        outstandingBalance: '320000.00',
        balanceUpdatedAt: TODAY_NOW,
      });
      expect(
        (await patch(loan.id, { status: 'active' }).expect(200)).body,
      ).toMatchObject({ status: 'active', outstandingBalance: '320000.00' });
    });

    it('US-L16：active 的貸款把結清日改成去年或昨天 → 400 LOAN_END_DATE_IN_PAST，資料不變；改成今天可以', async () => {
      const loan = await create();
      for (const endDate of ['2025-10-28', '2026-10-27']) {
        expectError(
          await patch(loan.id, { endDate }).expect(400),
          'LOAN_END_DATE_IN_PAST',
          'endDate',
        );
      }
      expect((await get(loan.id).expect(200)).body).toMatchObject({
        endDate: BODY.endDate,
      });
      await patch(loan.id, { endDate: TODAY }).expect(200);
    });

    it('US-L17：已結清、結清日已過，改回 active 但結清日沒改 → 400 LOAN_END_DATE_IN_PAST', async () => {
      const loan = await create({
        ...BODY,
        status: 'closed',
        endDate: '2026-09-30',
      });
      expectError(
        await patch(loan.id, { status: 'active' }).expect(400),
        'LOAN_END_DATE_IN_PAST',
        'endDate',
      );
      // 同時把結清日改到未來就可以
      await patch(loan.id, { status: 'active', endDate: '2027-09-30' }).expect(
        200,
      );
    });

    // D-E-004：10/01 建 active、結清日 10/31，到了 11/04 結清日已過、還沒改成已結清
    it.each([
      [
        '整份送出只改備註',
        (l: LoanBody) => ({ ...editable(l), note: '改' }),
        200,
      ],
      ['只改餘額', () => ({ outstandingBalance: '1' }), 200],
      ['整份送出、結清日同一天', (l: LoanBody) => editable(l), 200],
      ['結清日改成 10/15', () => ({ endDate: '2026-10-15' }), 400],
      ['結清日改成 12/31', () => ({ endDate: '2026-12-31' }), 200],
      ['改成已結清', () => ({ status: 'closed' }), 200],
    ])(
      'D-E-004：結清日自然過期後，%s → %i',
      async (_label, makeBody: (l: LoanBody) => object, status) => {
        clock.setTaipeiDate('2026-10-01');
        const loan = await create({ ...BODY, endDate: '2026-10-31' });
        clock.setTaipeiDate('2026-11-04');
        const res = await patch(loan.id, makeBody(loan)).expect(status);
        if (status === 400) {
          expectError(res, 'LOAN_END_DATE_IN_PAST', 'endDate');
        }
      },
    );

    it.each([
      ['userId', NOT_EXIST],
      ['balanceUpdatedAt', TODAY_NOW],
      ['id', NOT_EXIST],
    ])(
      'US-L22：PATCH 多帶 %s → 400 VALIDATION_FAILED，資料不變',
      async (field, value) => {
        const loan = await create();
        expectError(
          await patch(loan.id, { note: '改', [field]: value }).expect(400),
          'VALIDATION_FAILED',
          field,
        );
        expect((await get(loan.id).expect(200)).body).toEqual(loan);
      },
    );

    it('Q12：結清日改成今天加 50 年可以；晚一天回 400 VALIDATION_FAILED（endDate）', async () => {
      const loan = await create();
      await patch(loan.id, { endDate: '2076-10-28' }).expect(200);
      expectError(
        await patch(loan.id, { endDate: '2076-10-29' }).expect(400),
        'VALIDATION_FAILED',
        'endDate',
      );
    });
  });

  describe('DELETE /loans/:id', () => {
    it('US-L14：刪除已結清的貸款回 204，之後 GET、再刪一次都是 404；帳單與交易不受影響', async () => {
      const account = await prisma.account.create({
        data: {
          userId,
          name: '薪轉戶',
          accountType: AccountType.bank,
          openingBalance: new Prisma.Decimal('100000'),
        },
      });
      const categoryId = await createCategory(
        prisma,
        'loan_payment',
        CategoryType.expense,
      );
      await prisma.bill.create({
        data: {
          userId,
          name: '房貸',
          amount: new Prisma.Decimal('17969'),
          categoryId,
          accountId: account.id,
          dueDate: toDbDate('2026-10-31'),
          dueDay: 31,
        },
      });
      await createTransaction(prisma, {
        userId,
        accountId: account.id,
        transactionType: TransactionType.expense,
        amount: '17969',
        transactionDate: '2026-09-30',
        categoryId,
      });

      const loan = await create({
        ...BODY,
        status: 'closed',
        endDate: '2026-09-30',
      });
      const res = await del(loan.id).expect(204);
      expect(res.text).toBe('');
      expectError(await get(loan.id).expect(404), 'LOAN_NOT_FOUND');
      expectError(await del(loan.id).expect(404), 'LOAN_NOT_FOUND');
      expect(await prisma.bill.count({ where: { userId } })).toBe(1);
      expect(await prisma.transaction.count({ where: { userId } })).toBe(1);
    });

    it('active 的貸款也可以刪', async () => {
      const loan = await create();
      await del(loan.id).expect(204);
      expectError(await get(loan.id).expect(404), 'LOAN_NOT_FOUND');
    });
  });

  describe('還款與貸款餘額', () => {
    // 繳帳單（POST /bills/:id/pay）不影響貸款的測試，等 BILL-5 實作時補在帳單的 e2e
    it('AC-09、US-L7：記一筆「貸款還款」支出 → 只多一筆交易，貸款完全不變', async () => {
      const account = await prisma.account.create({
        data: {
          userId,
          name: '薪轉戶',
          accountType: AccountType.bank,
          openingBalance: new Prisma.Decimal('100000'),
        },
      });
      const categoryId = await createCategory(
        prisma,
        'loan_payment',
        CategoryType.expense,
      );
      const loan = await create({ ...BODY, outstandingBalance: '320000' });

      clock.set('2026-11-05T01:00:00Z');
      await api()
        .post('/api/v1/transactions')
        .set('Authorization', auth)
        .send({
          transactionType: 'expense',
          amount: '17969',
          accountId: account.id,
          categoryId,
          transactionDate: '2026-11-05',
        })
        .expect(201);

      expect(await prisma.transaction.count({ where: { userId } })).toBe(1);
      // 餘額、balanceUpdatedAt、updatedAt 都跟新增時一樣
      expect((await get(loan.id).expect(200)).body).toEqual(loan);
    });
  });

  describe('擁有權與 :id', () => {
    it('US-L10：別人的貸款讀取、修改、刪除都是 404 LOAN_NOT_FOUND，資料不變', async () => {
      const loan = await create();
      const other = await bearer(
        app,
        await createUser(prisma, 'e-loans-other@example.com'),
      );
      expectError(await get(loan.id, other).expect(404), 'LOAN_NOT_FOUND');
      expectError(
        await patch(loan.id, { name: '偷改' }, other).expect(404),
        'LOAN_NOT_FOUND',
      );
      expectError(await del(loan.id, other).expect(404), 'LOAN_NOT_FOUND');
      expect((await get(loan.id).expect(200)).body).toEqual(loan);
    });

    it.each(['not-a-uuid', NOT_EXIST])(
      'GET、PATCH、DELETE /loans/%s → 404 LOAN_NOT_FOUND',
      async (id) => {
        for (const res of [
          await get(id),
          await patch(id, { name: '房貸' }),
          await del(id),
        ]) {
          expect(res.status).toBe(404);
          expect(res.body).toMatchObject({
            code: 'LOAN_NOT_FOUND',
            message: '找不到這筆貸款',
            details: [],
          });
        }
      },
    );

    it('payment-preview 宣告在 :id 之前：回 200，不是被 :id 接走的 404', async () => {
      await api()
        .get('/api/v1/loans/payment-preview')
        .query({
          outstandingBalance: '1000',
          interestRate: '3',
          paymentDay: '5',
          endDate: '2027-10-05',
        })
        .set('Authorization', auth)
        .expect(200);
    });
  });

  it.each([
    ['get', '/api/v1/loans'],
    ['post', '/api/v1/loans'],
    ['get', `/api/v1/loans/${NOT_EXIST}`],
    ['patch', `/api/v1/loans/${NOT_EXIST}`],
    ['delete', `/api/v1/loans/${NOT_EXIST}`],
  ] as const)('US-L23：%s %s 沒帶 token → 401', async (method, path) => {
    const res = await api()[method](path).send(BODY).expect(401);
    expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });
});
