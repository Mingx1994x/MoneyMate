import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import {
  BillStatus,
  CategoryType,
  PrismaService,
  type PrismaTx,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import {
  createCategory,
  createUser,
  resetDb,
  seedCategories,
} from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

const TODAY = '2026-10-28';
const MISSING_ID = '5c3a1e8f-7d2b-4f6a-b9e0-1d4c7a2f8b36';

type Bill = {
  id: string;
  seriesId: string;
  name: string;
  amount: string;
  categoryId: string;
  accountId: string;
  dueDate: string;
  dueDay: number;
  dueMonth: number | null;
  recurrence: string;
  status: string;
  paidAmount: string | null;
  paidDate: string | null;
  isOverdue: boolean;
  note: string | null;
};
type PayResult = { bill: Bill; nextBill: Bill | null };
type StopResult = { stopped: boolean; bill: Bill | null };

/**
 * BILL-5（繳費）、BILL-6（取消繳費）、BILL-7（停止重複）、BILL-8（同時送出的請求）。
 * 繳費的支出由 C 的 createBillTransaction、deleteBillTransaction 建立與刪除，這裡從 API 與資料庫確認結果。
 */
describe('帳單繳費、取消繳費、停止重複（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;
  let userId: string;
  let auth: string;
  let otherAuth: string;
  let categories: Record<string, string>;
  let bankId: string;

  const http = () => request(app.getHttpServer());
  const create = async (overrides: Record<string, unknown> = {}) => {
    const res = await http()
      .post('/api/v1/bills')
      .set('Authorization', auth)
      .send({
        name: '房租',
        amount: '15000.00',
        categoryId: categories.housing,
        accountId: bankId,
        dueDate: '2026-11-01',
        recurrence: 'monthly',
        ...overrides,
      })
      .expect(201);
    return res.body as Bill;
  };
  const payReq = (id: string, data?: Record<string, unknown>, as = auth) =>
    http().post(`/api/v1/bills/${id}/pay`).set('Authorization', as).send(data);
  const unpayReq = (id: string, as = auth) =>
    http().post(`/api/v1/bills/${id}/unpay`).set('Authorization', as);
  const stopReq = (id: string, data: unknown, as = auth) =>
    http()
      .post(`/api/v1/bills/${id}/stop-recurrence`)
      .set('Authorization', as)
      .send(data as object);
  const deleteReq = (id: string) =>
    http().delete(`/api/v1/bills/${id}`).set('Authorization', auth);

  const pay = async (id: string, data?: Record<string, unknown>) => {
    const res = await payReq(id, data);
    expect(res.status).toBe(200);
    return res.body as PayResult;
  };
  const unpay = async (id: string) => {
    const res = await unpayReq(id);
    expect(res.status).toBe(200);
    return res.body as Bill;
  };
  const stop = async (id: string, keepCurrent: boolean) => {
    const res = await stopReq(id, { keepCurrent });
    expect(res.status).toBe(200);
    return res.body as StopResult;
  };
  const get = async (id: string) => {
    const res = await http()
      .get(`/api/v1/bills/${id}`)
      .set('Authorization', auth)
      .expect(200);
    return res.body as Bill;
  };
  const balance = async (accountId = bankId) => {
    const res = await http()
      .get(`/api/v1/accounts/${accountId}`)
      .set('Authorization', auth)
      .expect(200);
    return (res.body as { currentBalance: string }).currentBalance;
  };
  /** 系列的所有帳單，依到期日排序 */
  const series = (seriesId: string) =>
    prisma.bill.findMany({
      where: { seriesId },
      orderBy: { dueDate: 'asc' },
      select: { id: true, status: true, recurrence: true, dueMonth: true },
    });
  const pendingCount = (seriesId: string) =>
    prisma.bill.count({ where: { seriesId, status: BillStatus.pending } });
  const txCount = (billId: string) =>
    prisma.transaction.count({ where: { billId } });

  const expectError = (
    res: request.Response,
    status: number,
    code: string,
    field?: string,
  ) => {
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({
      code,
      details:
        field === undefined ? [] : [expect.objectContaining({ field, code })],
    });
  };

  const createAccount = async (
    owner: string,
    name: string,
    openingBalance = 100000,
  ) =>
    (
      await prisma.account.create({
        data: { userId: owner, name, accountType: 'bank', openingBalance },
        select: { id: true },
      })
    ).id;
  /** 帳單建立後才停用扣款帳戶（停用的帳戶不能建立帳單） */
  const deactivate = (accountId: string) =>
    prisma.account.update({
      where: { id: accountId },
      data: { isActive: false },
    });

  beforeAll(async () => {
    clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  beforeEach(async () => {
    clock.setTaipeiDate(TODAY);
    await resetDb(prisma);
    categories = await seedCategories(prisma);
    userId = await createUser(prisma, 'bill-payer@example.com');
    const otherId = await createUser(prisma, 'bill-stranger@example.com');
    auth = await bearer(app, userId);
    otherAuth = await bearer(app, otherId);
    bankId = await createAccount(userId, '台新');
  });

  describe('POST /bills/:id/pay（BILL-5）', () => {
    it('空 body 繳房租：帳單已繳、支出 15,000、餘額減少，產生 12/1 的下一期（US-B1、B2、B30）', async () => {
      const nov = await create({ note: '每月 1 日' });
      const { bill, nextBill } = await pay(nov.id);

      expect(bill).toMatchObject({
        id: nov.id,
        status: 'paid',
        paidAmount: '15000.00',
        paidDate: TODAY,
        isOverdue: false,
      });
      expect(nextBill).toMatchObject({
        seriesId: nov.seriesId,
        name: '房租',
        amount: '15000.00',
        categoryId: categories.housing,
        accountId: bankId,
        dueDate: '2026-12-01',
        dueDay: 1,
        dueMonth: null,
        recurrence: 'monthly',
        status: 'pending',
        paidAmount: null,
        paidDate: null,
        note: '每月 1 日',
      });
      expect(nextBill?.id).not.toBe(nov.id);
      expect(await get(nov.id)).toMatchObject({ status: 'paid' });

      const row = await prisma.transaction.findUniqueOrThrow({
        where: { billId: nov.id },
      });
      const tx = await http()
        .get(`/api/v1/transactions/${row.id}`)
        .set('Authorization', auth)
        .expect(200);
      // note 只寫帳單名稱，帳單自己的備註不帶進交易（Q14）
      expect(tx.body).toMatchObject({
        transactionType: 'expense',
        amount: '15000.00',
        accountId: bankId,
        categoryId: categories.housing,
        transactionDate: TODAY,
        note: '房租',
        billId: nov.id,
        isBillGenerated: true,
      });
      expect(await balance()).toBe('85000.00');
    });

    it('實繳 1,180：支出與 paidAmount 是 1,180，下一期仍是預定金額 1,200（US-B3）', async () => {
      const bill = await create({ name: '電費', amount: '1200' });
      const res = await pay(bill.id, { paidAmount: '1180' });
      expect(res.bill.paidAmount).toBe('1180.00');
      expect(res.bill.amount).toBe('1200.00');
      expect(res.nextBill?.amount).toBe('1200.00');
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { billId: bill.id },
      });
      expect(row.amount.toFixed(2)).toBe('1180.00');
      expect(await balance()).toBe('98820.00');
    });

    it('指定過去的繳費日：支出日期、paidDate 都是那天；今天也可以', async () => {
      const a = await create();
      const res = await pay(a.id, { paidDate: '2026-10-20' });
      expect(res.bill.paidDate).toBe('2026-10-20');
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { billId: a.id },
      });
      expect(row.transactionDate).toEqual(new Date('2026-10-20T00:00:00Z'));

      const b = await create({ name: '手機費', amount: '999' });
      expect((await pay(b.id, { paidDate: TODAY })).bill.paidDate).toBe(TODAY);
    });

    it('paidDate 是明天 → 400 PAID_DATE_IN_FUTURE（paidDate），沒有寫入任何資料（US-B4）', async () => {
      const bill = await create();
      const res = await payReq(bill.id, { paidDate: '2026-10-29' });
      expectError(res, 400, 'PAID_DATE_IN_FUTURE', 'paidDate');
      expect(await get(bill.id)).toMatchObject({ status: 'pending' });
      expect(await txCount(bill.id)).toBe(0);
      expect(await series(bill.seriesId)).toHaveLength(1);
    });

    it('「今天」是台北時間：UTC 10/28 16:30 已經是台北 10/29，paidDate 10/29 可以、10/30 不行', async () => {
      clock.set('2026-10-28T16:30:00Z');
      const a = await create();
      expect((await pay(a.id, { paidDate: '2026-10-29' })).bill.paidDate).toBe(
        '2026-10-29',
      );
      const b = await create({ name: '手機費' });
      expectError(
        await payReq(b.id, { paidDate: '2026-10-30' }),
        400,
        'PAID_DATE_IN_FUTURE',
        'paidDate',
      );
      // 沒帶 paidDate：預設也是台北今天
      const c = await create({ name: '電費' });
      expect((await pay(c.id)).bill.paidDate).toBe('2026-10-29');
    });

    it.each([
      [
        'paidAmount 是 0',
        'AMOUNT_NOT_POSITIVE',
        'paidAmount',
        { paidAmount: '0' },
      ],
      [
        'paidAmount 是負數',
        'AMOUNT_NOT_POSITIVE',
        'paidAmount',
        { paidAmount: '-1' },
      ],
      [
        'paidAmount 不是金額',
        'AMOUNT_INVALID',
        'paidAmount',
        { paidAmount: 'abc' },
      ],
      [
        'paidAmount 超過 2 位小數',
        'AMOUNT_INVALID',
        'paidAmount',
        { paidAmount: '1.001' },
      ],
      [
        'paidAmount 是 null',
        'AMOUNT_INVALID',
        'paidAmount',
        { paidAmount: null },
      ],
      [
        'paidDate 不是日期',
        'VALIDATION_FAILED',
        'paidDate',
        { paidDate: '2026-02-30' },
      ],
      ['paidDate 是 null', 'VALIDATION_FAILED', 'paidDate', { paidDate: null }],
      [
        '帶了 pay 不接受的 accountId',
        'VALIDATION_FAILED',
        'accountId',
        { accountId: MISSING_ID },
      ],
    ])('%s → 400 %s（%s），沒有繳費', async (_name, code, field, data) => {
      const bill = await create();
      expectError(await payReq(bill.id, data), 400, code, field);
      expect(await get(bill.id)).toMatchObject({ status: 'pending' });
      expect(await txCount(bill.id)).toBe(0);
    });

    it('不重複的帳單：nextBill 是 null，系列只有這一張', async () => {
      const bill = await create({ recurrence: 'none' });
      const res = await pay(bill.id);
      expect(res.nextBill).toBeNull();
      expect(await series(bill.seriesId)).toHaveLength(1);
    });

    it('每年帳單：下一期是明年同月日，dueMonth 沿用', async () => {
      const bill = await create({
        name: '汽車保險',
        categoryId: categories.insurance,
        dueDate: '2026-12-31',
        recurrence: 'yearly',
      });
      const { nextBill } = await pay(bill.id);
      expect(nextBill).toMatchObject({
        dueDate: '2027-12-31',
        dueDay: 31,
        dueMonth: 12,
        recurrence: 'yearly',
      });
    });

    it('31 號的帳單：下一期 11/30，再下一期回到 12/31（US-B9）', async () => {
      const oct = await create({ dueDate: '2026-10-31' });
      const nov = (await pay(oct.id)).nextBill;
      expect(nov).toMatchObject({ dueDate: '2026-11-30', dueDay: 31 });
      const dec = (await pay(nov!.id)).nextBill;
      expect(dec).toMatchObject({ dueDate: '2026-12-31', dueDay: 31 });
    });

    it('逾期補繳：下一期從到期日推算，不是繳費日；房租的下一期立刻也逾期（US-B19）', async () => {
      const phone = await create({
        name: '手機費',
        amount: '999',
        dueDate: '2026-10-25',
      });
      expect((await pay(phone.id)).nextBill).toMatchObject({
        dueDate: '2026-11-25',
        isOverdue: false,
      });

      const rent = await create({ dueDate: '2026-09-01' });
      const res = await pay(rent.id);
      // 繳完的本期不算逾期（逾期只看待繳）
      expect(res.bill).toMatchObject({ status: 'paid', isOverdue: false });
      expect(res.nextBill).toMatchObject({
        dueDate: '2026-10-01',
        isOverdue: true,
      });
    });

    it('已繳的帳單再繳 → 409 BILL_ALREADY_PAID，只有一筆支出、一張下一期（US-B5）', async () => {
      const bill = await create();
      await pay(bill.id);
      expectError(await payReq(bill.id), 409, 'BILL_ALREADY_PAID');
      expect(await txCount(bill.id)).toBe(1);
      expect(await series(bill.seriesId)).toHaveLength(2);
    });

    it('已繳的帳單帶未來的 paidDate：先回 409 BILL_ALREADY_PAID（規格 2.6 的檢查順序）', async () => {
      const bill = await create();
      await pay(bill.id);
      expectError(
        await payReq(bill.id, { paidDate: '2026-12-01' }),
        409,
        'BILL_ALREADY_PAID',
      );
    });

    // 規格 2.6 第 3→4→5 步、2.7 第 3→4→5 步：帳戶停用（C 的方法裡檢查）排在狀態與日期的檢查之後
    it.each([
      ['已繳再繳', 'BILL_ALREADY_PAID', 409],
      ['待繳、paidDate 是明天', 'PAID_DATE_IN_FUTURE', 400],
      ['待繳取消繳費', 'BILL_NOT_PAID', 409],
      ['11 月、12 月都已繳時取消 11 月', 'NEXT_BILL_ALREADY_PAID', 409],
    ] as const)(
      '扣款帳戶也已停用，%s：先回 %s，不是 ACCOUNT_INACTIVE',
      async (_name, code, status) => {
        const nov = await create();
        let res: request.Response;
        if (code === 'BILL_ALREADY_PAID') {
          await pay(nov.id);
          await deactivate(bankId);
          res = await payReq(nov.id);
        } else if (code === 'PAID_DATE_IN_FUTURE') {
          await deactivate(bankId);
          res = await payReq(nov.id, { paidDate: '2026-10-29' });
        } else if (code === 'BILL_NOT_PAID') {
          await deactivate(bankId);
          res = await unpayReq(nov.id);
        } else {
          const dec = (await pay(nov.id)).nextBill!;
          await pay(dec.id);
          await deactivate(bankId);
          res = await unpayReq(nov.id);
        }
        expectError(
          res,
          status,
          code,
          code === 'PAID_DATE_IN_FUTURE' ? 'paidDate' : undefined,
        );
      },
    );

    it('扣款帳戶已停用 → 409 ACCOUNT_INACTIVE（details 是 []），帳單仍待繳、沒有支出與下一期（US-B12）', async () => {
      const bill = await create();
      await deactivate(bankId);
      expectError(await payReq(bill.id), 409, 'ACCOUNT_INACTIVE');
      expect(await get(bill.id)).toMatchObject({
        status: 'pending',
        paidAmount: null,
        paidDate: null,
      });
      expect(await txCount(bill.id)).toBe(0);
      expect(await series(bill.seriesId)).toHaveLength(1);
    });

    it('改用別的帳戶付：先 PATCH 待繳帳單的 accountId，支出與下一期都用新帳戶（US-B12、B20）', async () => {
      const cathay = await createAccount(userId, '國泰');
      const bill = await create();
      await http()
        .patch(`/api/v1/bills/${bill.id}`)
        .set('Authorization', auth)
        .send({ accountId: cathay })
        .expect(200);
      const { nextBill } = await pay(bill.id);
      expect(nextBill?.accountId).toBe(cathay);
      expect(await balance(cathay)).toBe('85000.00');
      expect(await balance()).toBe('100000.00');
    });

    it('餘額不足也可以繳，餘額變成負數（Q16、US-B31）', async () => {
      const poor = await createAccount(userId, '快沒錢的帳戶', 1000);
      const bill = await create({ accountId: poor });
      await pay(bill.id);
      expect(await balance(poor)).toBe('-14000.00');
    });

    it('帳單的自訂分類之後被停用：照常繳費，支出與下一期沿用原分類（Q17）', async () => {
      const custom = await createCategory(
        prisma,
        'my_rent',
        CategoryType.expense,
        { userId },
      );
      const bill = await create({ categoryId: custom });
      await prisma.category.update({
        where: { id: custom },
        data: { isActive: false },
      });
      const { nextBill } = await pay(bill.id);
      expect(nextBill?.categoryId).toBe(custom);
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { billId: bill.id },
      });
      expect(row.categoryId).toBe(custom);
    });

    it('繳費後改帳單名稱：支出的 note 不會跟著改（Q14）', async () => {
      const bill = await create();
      await pay(bill.id);
      await http()
        .patch(`/api/v1/bills/${bill.id}`)
        .set('Authorization', auth)
        .send({ name: '11 月房租' })
        .expect(200);
      const row = await prisma.transaction.findUniqueOrThrow({
        where: { billId: bill.id },
      });
      expect(row.note).toBe('房租');
    });
  });

  describe('POST /bills/:id/unpay（BILL-6）', () => {
    it('取消 11 月：支出消失、餘額恢復、12 月待繳刪除、11 月改回待繳；再繳會重新產生 12 月（US-B6）', async () => {
      const nov = await create();
      const { nextBill: dec } = await pay(nov.id, { paidAmount: '14800' });

      const res = await unpay(nov.id);
      expect(res).toMatchObject({
        id: nov.id,
        status: 'pending',
        amount: '15000.00',
        paidAmount: null,
        paidDate: null,
        recurrence: 'monthly',
        dueMonth: null,
      });
      expect(await txCount(nov.id)).toBe(0);
      expect(await balance()).toBe('100000.00');
      expect(await prisma.bill.count({ where: { id: dec!.id } })).toBe(0);
      expect(await series(nov.seriesId)).toHaveLength(1);

      const again = await pay(nov.id);
      expect(again.nextBill).toMatchObject({
        dueDate: '2026-12-01',
        status: 'pending',
      });
      expect(again.nextBill?.id).not.toBe(dec!.id);
    });

    it('11 月、12 月都已繳時取消 11 月 → 409 NEXT_BILL_ALREADY_PAID，資料不變；從 12 月往回取消就可以（US-B7）', async () => {
      const nov = await create();
      const dec = (await pay(nov.id)).nextBill!;
      const jan = (await pay(dec.id)).nextBill!;

      expectError(await unpayReq(nov.id), 409, 'NEXT_BILL_ALREADY_PAID');
      expect(await series(nov.seriesId)).toMatchObject([
        { id: nov.id, status: 'paid' },
        { id: dec.id, status: 'paid' },
        { id: jan.id, status: 'pending' },
      ]);
      expect(await txCount(nov.id)).toBe(1);
      expect(await txCount(dec.id)).toBe(1);

      await unpay(dec.id);
      await unpay(nov.id);
      expect(await series(nov.seriesId)).toMatchObject([
        { id: nov.id, status: 'pending' },
      ]);
    });

    it('不重複的帳單：改回待繳，沒有下一期要刪（US-B25）', async () => {
      const bill = await create({ recurrence: 'none' });
      await pay(bill.id);
      expect(await unpay(bill.id)).toMatchObject({
        status: 'pending',
        recurrence: 'none',
      });
      expect(await txCount(bill.id)).toBe(0);
      expect(await series(bill.seriesId)).toHaveLength(1);
    });

    it('待繳的帳單 → 409 BILL_NOT_PAID（US-B25）', async () => {
      const bill = await create();
      expectError(await unpayReq(bill.id), 409, 'BILL_NOT_PAID');
      expect(await get(bill.id)).toMatchObject({ status: 'pending' });
    });

    it('扣款帳戶已停用 → 409 ACCOUNT_INACTIVE（details 是 []），整個回滾：下一期、支出都還在，這張仍是已繳（Q2、US-B13）', async () => {
      const nov = await create();
      const { nextBill: dec } = await pay(nov.id);
      await deactivate(bankId);

      expectError(await unpayReq(nov.id), 409, 'ACCOUNT_INACTIVE');
      expect(await get(nov.id)).toMatchObject({
        status: 'paid',
        paidAmount: '15000.00',
        paidDate: TODAY,
      });
      expect(await txCount(nov.id)).toBe(1);
      // 下一期是在帳戶檢查之前刪的，要確認有跟著回滾
      expect(await get(dec!.id)).toMatchObject({ status: 'pending' });
    });

    describe('系列已經停止時，改回待繳的這張也改成不重複（1109-BILL）', () => {
      it('停止重複並刪除待繳 → 取消上一期：這張改成不重複，重繳不產生下一期（案例 1）', async () => {
        const nov = await create();
        await pay(nov.id);
        await stop(nov.id, false);

        expect(await unpay(nov.id)).toMatchObject({
          status: 'pending',
          recurrence: 'none',
          dueMonth: null,
        });
        expect((await pay(nov.id)).nextBill).toBeNull();
      });

      it('直接刪除最新的待繳 → 取消上一期：同案例 1（案例 2）', async () => {
        const nov = await create();
        const { nextBill: dec } = await pay(nov.id);
        await deleteReq(dec!.id).expect(204);

        expect((await unpay(nov.id)).recurrence).toBe('none');
        expect((await pay(nov.id)).nextBill).toBeNull();
      });

      it('停止重複並保留待繳 → 取消上一期：待繳那張刪掉，這張改成不重複（案例 3）', async () => {
        const nov = await create();
        const { nextBill: dec } = await pay(nov.id);
        await stop(nov.id, true);

        expect((await unpay(nov.id)).recurrence).toBe('none');
        expect(await prisma.bill.count({ where: { id: dec!.id } })).toBe(0);
        expect((await pay(nov.id)).nextBill).toBeNull();
      });

      it('把待繳那張 PATCH 成不重複 → 取消上一期：這張也改成不重複', async () => {
        const nov = await create();
        const { nextBill: dec } = await pay(nov.id);
        await http()
          .patch(`/api/v1/bills/${dec!.id}`)
          .set('Authorization', auth)
          .send({ recurrence: 'none' })
          .expect(200);

        expect((await unpay(nov.id)).recurrence).toBe('none');
        expect(await series(nov.seriesId)).toHaveLength(1);
        expect((await pay(nov.id)).nextBill).toBeNull();
      });

      it('待繳那張還是每月：這張維持每月，重繳重新產生下一期（案例 4，同 US-B6）', async () => {
        const nov = await create();
        await pay(nov.id);
        expect((await unpay(nov.id)).recurrence).toBe('monthly');
        // 待繳那張（12 月）刪掉
        expect(await series(nov.seriesId)).toHaveLength(1);
        expect((await pay(nov.id)).nextBill).not.toBeNull();
      });

      it('每年帳單停止並刪除待繳 → 取消上一期：recurrence 是 none、dueMonth 是 null（案例 5，資料庫的 CHECK 不會擋）', async () => {
        const bill = await create({
          name: '汽車保險',
          categoryId: categories.insurance,
          dueDate: '2026-12-31',
          recurrence: 'yearly',
        });
        await pay(bill.id);
        await stop(bill.id, false);

        expect(await unpay(bill.id)).toMatchObject({
          recurrence: 'none',
          dueMonth: null,
        });
        const row = await prisma.bill.findUniqueOrThrow({
          where: { id: bill.id },
        });
        expect(row.dueMonth).toBeNull();
        expect((await pay(bill.id)).nextBill).toBeNull();
      });

      it('每年帳單待繳那張還是每年：這張維持每年，dueMonth 不變', async () => {
        const bill = await create({
          name: '汽車保險',
          categoryId: categories.insurance,
          dueDate: '2026-12-31',
          recurrence: 'yearly',
        });
        await pay(bill.id);
        expect(await unpay(bill.id)).toMatchObject({
          recurrence: 'yearly',
          dueMonth: 12,
        });
      });
    });
  });

  describe('POST /bills/:id/stop-recurrence（BILL-7）', () => {
    /** 10 月已繳、11 月待繳的房租系列 */
    const rentSeries = async () => {
      const oct = await create({ dueDate: '2026-10-01' });
      const nov = (await pay(oct.id)).nextBill!;
      return { oct, nov };
    };

    it('從最新的待繳期保留：改成不重複，繳清後不產生下一期（US-B8、B26）', async () => {
      const { oct, nov } = await rentSeries();
      const res = await stop(nov.id, true);
      expect(res).toMatchObject({
        stopped: true,
        bill: {
          id: nov.id,
          status: 'pending',
          recurrence: 'none',
          dueMonth: null,
        },
      });
      expect((await pay(nov.id)).nextBill).toBeNull();
      // 已繳的歷史不動
      expect(await get(oct.id)).toMatchObject({
        status: 'paid',
        recurrence: 'monthly',
      });
    });

    it('從最新的待繳期刪除：待繳刪掉，回 bill: null；已繳的歷史保留（US-B8）', async () => {
      const { oct, nov } = await rentSeries();
      expect(await stop(nov.id, false)).toEqual({ stopped: true, bill: null });
      expect(await prisma.bill.count({ where: { id: nov.id } })).toBe(0);
      expect(await get(oct.id)).toMatchObject({
        status: 'paid',
        recurrence: 'monthly',
        paidAmount: '15000.00',
      });
      expect(await txCount(oct.id)).toBe(1);
    });

    it('從歷史的已繳期進來：處理的是同系列的待繳那張（保留）', async () => {
      const { oct, nov } = await rentSeries();
      const res = await stop(oct.id, true);
      expect(res.bill).toMatchObject({ id: nov.id, recurrence: 'none' });
      expect(await get(oct.id)).toMatchObject({ recurrence: 'monthly' });
    });

    it('從歷史的已繳期進來：處理的是同系列的待繳那張（刪除）', async () => {
      const { oct, nov } = await rentSeries();
      expect(await stop(oct.id, false)).toEqual({ stopped: true, bill: null });
      expect(await prisma.bill.count({ where: { id: nov.id } })).toBe(0);
      expect(await series(oct.seriesId)).toHaveLength(1);
    });

    it('系列沒有待繳 → 200 stopped: false、bill: null，什麼都不做', async () => {
      const bill = await create({ recurrence: 'none' });
      await pay(bill.id);
      expect(await stop(bill.id, true)).toEqual({ stopped: false, bill: null });
      expect(await stop(bill.id, false)).toEqual({
        stopped: false,
        bill: null,
      });
      expect(await get(bill.id)).toMatchObject({ status: 'paid' });
    });

    it('已經是不重複的待繳再按一次保留：stopped: true，沒有實質改變', async () => {
      const bill = await create({ recurrence: 'none' });
      expect(await stop(bill.id, true)).toMatchObject({
        stopped: true,
        bill: { id: bill.id, recurrence: 'none' },
      });
    });

    it('每年帳單保留待繳：dueMonth 改成 null（資料庫的 CHECK 不會擋）', async () => {
      const bill = await create({
        name: '汽車保險',
        categoryId: categories.insurance,
        dueDate: '2026-12-31',
        recurrence: 'yearly',
      });
      expect((await stop(bill.id, true)).bill).toMatchObject({
        recurrence: 'none',
        dueMonth: null,
      });
      const row = await prisma.bill.findUniqueOrThrow({
        where: { id: bill.id },
      });
      expect(row.dueMonth).toBeNull();
    });

    it.each([
      ['沒帶 body', undefined],
      ['keepCurrent 是字串', { keepCurrent: 'true' }],
      ['keepCurrent 是 null', { keepCurrent: null }],
    ])(
      '%s → 400 VALIDATION_FAILED（keepCurrent），資料不變',
      async (_name, data) => {
        const bill = await create();
        expectError(
          await stopReq(bill.id, data),
          400,
          'VALIDATION_FAILED',
          'keepCurrent',
        );
        expect(await get(bill.id)).toMatchObject({ recurrence: 'monthly' });
      },
    );
  });

  describe('他人的帳單與不存在的帳單（US-B29）', () => {
    it.each([
      ['pay', undefined],
      ['unpay', undefined],
      ['stop-recurrence', { keepCurrent: true }],
    ] as const)('POST /bills/:id/%s 不帶 token → 401', async (action, data) => {
      const res = await http()
        .post(`/api/v1/bills/${MISSING_ID}/${action}`)
        .send(data);
      expectError(res, 401, 'AUTH_UNAUTHENTICATED');
    });

    it('別人的帳單：繳費、取消繳費、停止重複都回 404，資料不變', async () => {
      const pending = await create();
      const paid = await create({ name: '手機費', dueDate: '2026-10-25' });
      await pay(paid.id);

      expectError(
        await payReq(pending.id, undefined, otherAuth),
        404,
        'BILL_NOT_FOUND',
      );
      expectError(await unpayReq(paid.id, otherAuth), 404, 'BILL_NOT_FOUND');
      expectError(
        await stopReq(pending.id, { keepCurrent: false }, otherAuth),
        404,
        'BILL_NOT_FOUND',
      );
      expect(await get(pending.id)).toMatchObject({
        status: 'pending',
        recurrence: 'monthly',
      });
      expect(await get(paid.id)).toMatchObject({ status: 'paid' });
      expect(await txCount(pending.id)).toBe(0);
      expect(await txCount(paid.id)).toBe(1);
    });

    it.each([
      ['pay', undefined],
      ['unpay', undefined],
      ['stop-recurrence', { keepCurrent: true }],
    ] as const)(
      '不存在的帳單 POST /bills/:id/%s → 404',
      async (action, data) => {
        const res = await http()
          .post(`/api/v1/bills/${MISSING_ID}/${action}`)
          .set('Authorization', auth)
          .send(data);
        expectError(res, 404, 'BILL_NOT_FOUND');
      },
    );
  });

  /**
   * 規格 6：鎖定系列之後要重新讀取。這裡由測試自己先鎖住系列、在鎖內改掉帳單，
   * 等 app 的請求確實卡在鎖上之後才提交，所以結果是確定的（不靠兩個請求剛好撞在一起）。
   * 只看鎖之前讀到的狀態的話：繳費會用「待繳」判斷而建立支出（回 200），被刪掉的帳單會 500。
   */
  describe('等鎖期間帳單被改掉（規格 6，鎖定後重新讀取）', () => {
    /** 等到有連線在等 FOR UPDATE 的鎖（app 的請求已經卡在鎖上） */
    const waitForLockWaiter = async () => {
      for (let i = 0; i < 200; i += 1) {
        const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%FOR UPDATE%'`;
        if (n > 0n) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('app 的請求沒有在等系列的鎖');
    };

    /** 測試持有系列的鎖、在鎖內執行 change，等 app 的請求卡在鎖上之後才提交 */
    const whileLocked = async (
      seriesId: string,
      change: (tx: PrismaTx) => Promise<unknown>,
      send: () => Promise<request.Response>,
    ) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const holder = prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM bills WHERE series_id = ${seriesId}::uuid FOR UPDATE`;
          await change(tx);
          await gate;
        },
        { timeout: 15_000 },
      );
      // supertest 要呼叫 then 才會送出
      const pending = send().then((r) => r);
      await waitForLockWaiter();
      release();
      await holder;
      return pending;
    };

    it('繳費時帳單在等鎖期間被繳掉 → 409 BILL_ALREADY_PAID，沒有建立支出', async () => {
      const bill = await create();
      const res = await whileLocked(
        bill.seriesId,
        (tx) =>
          tx.$executeRaw`UPDATE bills SET status = 'paid', paid_amount = amount, paid_date = due_date WHERE id = ${bill.id}::uuid`,
        () => payReq(bill.id),
      );
      expectError(res, 409, 'BILL_ALREADY_PAID');
      // 是重新讀取擋下的，不是 bill_id 唯一約束：舊狀態會建立支出、回 200
      expect(await txCount(bill.id)).toBe(0);
      expect(await series(bill.seriesId)).toHaveLength(1);
    });

    it.each([
      ['pay', (id: string) => payReq(id)],
      ['stop-recurrence', (id: string) => stopReq(id, { keepCurrent: true })],
    ] as const)(
      '%s 時帳單在等鎖期間被刪掉 → 404 BILL_NOT_FOUND，不是 500',
      async (_name, send) => {
        const bill = await create();
        const res = await whileLocked(
          bill.seriesId,
          (tx) => tx.bill.delete({ where: { id: bill.id } }),
          () => send(bill.id),
        );
        expectError(res, 404, 'BILL_NOT_FOUND');
      },
    );

    it('取消繳費時帳單在等鎖期間被改回待繳 → 409 BILL_NOT_PAID，不會 500', async () => {
      const bill = await create({ recurrence: 'none' });
      await pay(bill.id);
      const res = await whileLocked(
        bill.seriesId,
        async (tx) => {
          await tx.transaction.deleteMany({ where: { billId: bill.id } });
          await tx.bill.update({
            where: { id: bill.id },
            data: { status: 'pending', paidAmount: null, paidDate: null },
          });
        },
        () => unpayReq(bill.id),
      );
      expectError(res, 409, 'BILL_NOT_PAID');
    });
  });

  /**
   * BILL-8：同一個系列同時送兩個寫入，結果要等同某一種依序執行，而且任何時候都不會有兩張待繳、不會 500。
   * 兩個請求之間沒有 await，用 Promise.all 同時送出；不硬寫哪一個先到，兩種順序都接受。每種組合跑 20 次。
   */
  describe('同時送出的請求（BILL-8，US-B5、B28）', () => {
    const ROUNDS = 20;
    const statuses = (rs: request.Response[]) => rs.map((r) => r.status);

    it('同時繳兩次：一個 200、一個 409 BILL_ALREADY_PAID，只有一筆支出、一張下一期', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const bill = await create();
        const results = await Promise.all([payReq(bill.id), payReq(bill.id)]);
        expect(statuses(results).sort((a, b) => a - b)).toEqual([200, 409]);
        const loser = results.find((r) => r.status === 409)!;
        expect(loser.body).toMatchObject({ code: 'BILL_ALREADY_PAID' });
        expect(await txCount(bill.id)).toBe(1);
        expect(await series(bill.seriesId)).toMatchObject([
          { status: 'paid' },
          { status: 'pending' },
        ]);
      }
      expect(await balance()).toBe(`${100000 - 15000 * ROUNDS}.00`);
    });

    it('繳費＋取消繳費：先繳再取消（都 200，回到待繳），或先取消（409 BILL_NOT_PAID）再繳', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const bill = await create();
        const [paid, unpaid] = await Promise.all([
          payReq(bill.id),
          unpayReq(bill.id),
        ]);
        expect(paid.status).toBe(200);
        const rows = await series(bill.seriesId);
        if (unpaid.status === 200) {
          // 先繳再取消：下一期還是每月，這張就不改（1109 案例 4）
          expect(unpaid.body).toMatchObject({
            status: 'pending',
            recurrence: 'monthly',
            paidAmount: null,
          });
          expect(rows).toMatchObject([{ id: bill.id, status: 'pending' }]);
          expect(await txCount(bill.id)).toBe(0);
        } else {
          expectError(unpaid, 409, 'BILL_NOT_PAID');
          expect(rows).toMatchObject([
            { id: bill.id, status: 'paid' },
            { status: 'pending' },
          ]);
          expect(await txCount(bill.id)).toBe(1);
        }
      }
    });

    it('同時取消繳費兩次：一個 200、一個 409 BILL_NOT_PAID，支出刪掉、下一期刪掉', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const bill = await create();
        await pay(bill.id);
        const results = await Promise.all([
          unpayReq(bill.id),
          unpayReq(bill.id),
        ]);
        expect(statuses(results).sort((a, b) => a - b)).toEqual([200, 409]);
        expect(results.find((r) => r.status === 409)?.body).toMatchObject({
          code: 'BILL_NOT_PAID',
        });
        expect(await series(bill.seriesId)).toMatchObject([
          { id: bill.id, status: 'pending', recurrence: 'monthly' },
        ]);
        expect(await txCount(bill.id)).toBe(0);
      }
      expect(await balance()).toBe('100000.00');
    });

    it('繳費＋停止重複（刪除）：先繳再停（下一期被刪），或先停（帳單被刪，繳費 404）', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const bill = await create();
        const [paid, stopped] = await Promise.all([
          payReq(bill.id),
          stopReq(bill.id, { keepCurrent: false }),
        ]);
        expect(stopped.status).toBe(200);
        expect(stopped.body).toEqual({ stopped: true, bill: null });
        const rows = await series(bill.seriesId);
        if (paid.status === 200) {
          expect(rows).toMatchObject([{ id: bill.id, status: 'paid' }]);
          expect(await txCount(bill.id)).toBe(1);
        } else {
          expectError(paid, 404, 'BILL_NOT_FOUND');
          expect(rows).toHaveLength(0);
        }
      }
    });

    it('繳費＋停止重複（保留）：先繳再停（下一期改成不重複），或先停（繳費不產生下一期）', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const bill = await create();
        const [paid, stopped] = await Promise.all([
          payReq(bill.id),
          stopReq(bill.id, { keepCurrent: true }),
        ]);
        expect(paid.status).toBe(200);
        expect(stopped.status).toBe(200);
        const { nextBill } = paid.body as PayResult;
        const rows = await series(bill.seriesId);
        if (nextBill === null) {
          // 先停：這張改成不重複後才繳
          expect((stopped.body as StopResult).bill?.id).toBe(bill.id);
          expect(rows).toMatchObject([
            { id: bill.id, status: 'paid', recurrence: 'none' },
          ]);
        } else {
          // 先繳：停止的是新產生的下一期
          expect((stopped.body as StopResult).bill?.id).toBe(nextBill.id);
          expect(rows).toMatchObject([
            { id: bill.id, status: 'paid', recurrence: 'monthly' },
            { id: nextBill.id, status: 'pending', recurrence: 'none' },
          ]);
        }
      }
    });

    it('繳費＋刪除：先繳再刪（刪除 409，已繳不能刪），或先刪（繳費 404）', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const bill = await create();
        const [paid, deleted] = await Promise.all([
          payReq(bill.id),
          deleteReq(bill.id),
        ]);
        const rows = await series(bill.seriesId);
        if (paid.status === 200) {
          expectError(deleted, 409, 'BILL_ALREADY_PAID');
          expect(rows).toMatchObject([
            { id: bill.id, status: 'paid' },
            { status: 'pending' },
          ]);
        } else {
          expectError(paid, 404, 'BILL_NOT_FOUND');
          expect(deleted.status).toBe(204);
          expect(rows).toHaveLength(0);
          expect(await txCount(bill.id)).toBe(0);
        }
      }
    });

    it('上一期取消繳費＋下一期繳費：只有一個成功，另一個 409，不會出現兩張待繳', async () => {
      for (let i = 0; i < ROUNDS; i += 1) {
        const nov = await create();
        const dec = (await pay(nov.id)).nextBill!;
        const [unpaid, paid] = await Promise.all([
          unpayReq(nov.id),
          payReq(dec.id),
        ]);
        const rows = await series(nov.seriesId);
        if (unpaid.status === 200) {
          // 先取消：12 月被刪掉，繳 12 月 404
          expectError(paid, 404, 'BILL_NOT_FOUND');
          expect(rows).toMatchObject([{ id: nov.id, status: 'pending' }]);
          expect(await txCount(nov.id)).toBe(0);
        } else {
          // 先繳 12 月：11 月不能取消
          expectError(unpaid, 409, 'NEXT_BILL_ALREADY_PAID');
          expect(paid.status).toBe(200);
          expect(rows).toMatchObject([
            { id: nov.id, status: 'paid' },
            { id: dec.id, status: 'paid' },
            { status: 'pending' },
          ]);
          expect(await txCount(dec.id)).toBe(1);
        }
        expect(await pendingCount(nov.seriesId)).toBe(1);
      }
    });
  });
});
