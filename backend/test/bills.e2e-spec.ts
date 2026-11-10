import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { toDbDate, type DateOnly } from '../src/common/date-only.js';
import {
  BillStatus,
  CategoryType,
  PrismaService,
  Recurrence,
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
const UUID = /^[0-9a-f-]{36}$/;

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
type BillList = {
  items: Bill[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * BILL-2（CRUD）、BILL-3（列表）。繳費、取消繳費、停止重複還沒實作（501）。
 * 已繳的帳單要等繳費端點，這裡直接改資料庫做出來（markPaid）。
 */
describe('帳單（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;
  let userId: string;
  let auth: string;
  let otherAuth: string;
  let otherId: string;
  let categories: Record<string, string>;
  let bankId: string;
  let cashId: string;
  let inactiveId: string;
  let otherAccountId: string;

  const http = () => request(app.getHttpServer());
  const body = (overrides: Record<string, unknown> = {}) => ({
    name: '房租',
    amount: '15000.00',
    categoryId: categories.housing,
    accountId: bankId,
    dueDate: '2026-11-01',
    recurrence: 'monthly',
    ...overrides,
  });
  const create = async (overrides: Record<string, unknown> = {}) => {
    const res = await http()
      .post('/api/v1/bills')
      .set('Authorization', auth)
      .send(body(overrides))
      .expect(201);
    return res.body as Bill;
  };
  const patch = (id: string, data: Record<string, unknown>, as = auth) =>
    http().patch(`/api/v1/bills/${id}`).set('Authorization', as).send(data);
  const list = async (query = '') => {
    const res = await http()
      .get(`/api/v1/bills${query}`)
      .set('Authorization', auth)
      .expect(200);
    return res.body as BillList;
  };
  const dueDates = (l: BillList) => l.items.map((b) => b.dueDate);

  /** 繳費端點還沒實作：直接把帳單改成已繳（實繳金額＝預定金額、繳費日＝到期日） */
  const markPaid = (id: string) =>
    prisma.$executeRaw`UPDATE bills SET status = 'paid', paid_amount = amount, paid_date = due_date WHERE id = ${id}::uuid`;

  /** 同一個系列的下一期：照繳費時的做法，沿用本期的欄位、換到期日 */
  const nextPeriod = async (bill: Bill, dueDate: DateOnly): Promise<Bill> => {
    const row = await prisma.bill.create({
      data: {
        userId,
        seriesId: bill.seriesId,
        name: bill.name,
        amount: bill.amount,
        categoryId: bill.categoryId,
        accountId: bill.accountId,
        dueDate: toDbDate(dueDate),
        dueDay: bill.dueDay,
        dueMonth: bill.dueMonth,
        recurrence: bill.recurrence as Recurrence,
      },
      select: { id: true },
    });
    const res = await http()
      .get(`/api/v1/bills/${row.id}`)
      .set('Authorization', auth)
      .expect(200);
    return res.body as Bill;
  };

  /** 9/1、10/1 已繳，11/1 待繳的房租系列 */
  const rentSeries = async () => {
    const sep = await create({ dueDate: '2026-09-01' });
    await markPaid(sep.id);
    const oct = await nextPeriod(sep, '2026-10-01');
    await markPaid(oct.id);
    const nov = await nextPeriod(sep, '2026-11-01');
    return { sep, oct, nov };
  };

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
    opts: { isActive?: boolean; accountType?: 'bank' | 'cash' } = {},
  ) =>
    (
      await prisma.account.create({
        data: {
          userId: owner,
          name,
          accountType: opts.accountType ?? 'bank',
          // 停用的帳戶餘額一定是 0（PRD 15.11）
          openingBalance: opts.isActive === false ? 0 : 100000,
          isActive: opts.isActive ?? true,
        },
        select: { id: true },
      })
    ).id;

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
    userId = await createUser(prisma, 'bill-owner@example.com');
    otherId = await createUser(prisma, 'bill-other@example.com');
    auth = await bearer(app, userId);
    otherAuth = await bearer(app, otherId);
    bankId = await createAccount(userId, '台新');
    cashId = await createAccount(userId, '現金', { accountType: 'cash' });
    inactiveId = await createAccount(userId, '已停用的國泰', {
      isActive: false,
    });
    otherAccountId = await createAccount(otherId, '別人的帳戶');
  });

  describe('POST /bills', () => {
    it('新增每月房租：待繳、新的系列、dueDay 取到期日的日、dueMonth 是 null（US-B1）', async () => {
      const bill = await create({ note: '每月 1 日' });
      expect(bill).toMatchObject({
        id: expect.stringMatching(UUID) as string,
        seriesId: expect.stringMatching(UUID) as string,
        name: '房租',
        amount: '15000.00',
        categoryId: categories.housing,
        accountId: bankId,
        dueDate: '2026-11-01',
        dueDay: 1,
        dueMonth: null,
        recurrence: 'monthly',
        status: 'pending',
        paidAmount: null,
        paidDate: null,
        isOverdue: false,
        note: '每月 1 日',
      });
      expect(bill).not.toHaveProperty('userId');
      const row = await prisma.bill.findUniqueOrThrow({
        where: { id: bill.id },
      });
      expect(row.userId).toBe(userId);
      expect(row.seriesId).toBe(bill.seriesId);
    });

    it('沒帶 recurrence 是不重複；note 空字串存成 null；金額不帶小數也存成 2 位', async () => {
      const { recurrence: _omit, ...rest } = body();
      const res = await http()
        .post('/api/v1/bills')
        .set('Authorization', auth)
        .send({ ...rest, amount: '999', note: '' })
        .expect(201);
      expect(res.body).toMatchObject({
        recurrence: 'none',
        dueMonth: null,
        amount: '999.00',
        note: null,
      });
    });

    it('31 號的每月帳單：dueDay 31；每年 2/29 的帳單：dueMonth 2、dueDay 29（US-B23）', async () => {
      expect(await create({ dueDate: '2026-12-31' })).toMatchObject({
        dueDay: 31,
        dueMonth: null,
      });
      expect(
        await create({ dueDate: '2028-02-29', recurrence: 'yearly' }),
      ).toMatchObject({ dueDay: 29, dueMonth: 2, recurrence: 'yearly' });
    });

    it('到期日在過去也可以建立，建立後就是逾期（US-B23）', async () => {
      const bill = await create({ dueDate: '2026-10-20' });
      expect(bill).toMatchObject({ status: 'pending', isOverdue: true });
    });

    it('每次新增都是新的系列', async () => {
      const a = await create();
      const b = await create();
      expect(a.seriesId).not.toBe(b.seriesId);
    });

    it('到期日剛好是今天加 50 年可以；再晚 1 天回 VALIDATION_FAILED（dueDate）', async () => {
      await create({ dueDate: '2076-10-28' });
      const res = await http()
        .post('/api/v1/bills')
        .set('Authorization', auth)
        .send(body({ dueDate: '2076-10-29' }));
      expectError(res, 400, 'VALIDATION_FAILED', 'dueDate');
    });

    it.each([
      [
        '別人的帳戶',
        () => ({ accountId: otherAccountId }),
        400,
        'ACCOUNT_NOT_FOUND',
        'accountId',
      ],
      [
        '不存在的帳戶',
        () => ({ accountId: MISSING_ID }),
        400,
        'ACCOUNT_NOT_FOUND',
        'accountId',
      ],
      [
        '停用的帳戶',
        () => ({ accountId: inactiveId }),
        409,
        'ACCOUNT_INACTIVE',
        'accountId',
      ],
      [
        '收入分類',
        () => ({ categoryId: categories.salary }),
        400,
        'CATEGORY_TYPE_MISMATCH',
        'categoryId',
      ],
      [
        '不存在的分類',
        () => ({ categoryId: MISSING_ID }),
        400,
        'CATEGORY_NOT_FOUND',
        'categoryId',
      ],
    ] as const)(
      '%s → %i %s（US-B17、US-B24）',
      async (_name, overrides, status, code, field) => {
        const res = await http()
          .post('/api/v1/bills')
          .set('Authorization', auth)
          .send(body(overrides()));
        expectError(res, status, code, field);
        expect(await prisma.bill.count()).toBe(0);
      },
    );

    it('別人的自訂分類、自己停用的自訂分類 → CATEGORY_NOT_FOUND', async () => {
      const othersCategory = await createCategory(
        prisma,
        'others-pet',
        CategoryType.expense,
        { userId: otherId },
      );
      const inactiveCategory = await createCategory(
        prisma,
        'my-pet',
        CategoryType.expense,
        { userId, isActive: false },
      );
      for (const categoryId of [othersCategory, inactiveCategory]) {
        const res = await http()
          .post('/api/v1/bills')
          .set('Authorization', auth)
          .send(body({ categoryId }));
        expectError(res, 400, 'CATEGORY_NOT_FOUND', 'categoryId');
      }
    });

    it('先檢查帳戶再檢查分類：停用帳戶＋收入分類回 ACCOUNT_INACTIVE；別人的帳戶＋收入分類回 ACCOUNT_NOT_FOUND', async () => {
      const inactive = await http()
        .post('/api/v1/bills')
        .set('Authorization', auth)
        .send(body({ accountId: inactiveId, categoryId: categories.salary }));
      expectError(inactive, 409, 'ACCOUNT_INACTIVE', 'accountId');
      const others = await http()
        .post('/api/v1/bills')
        .set('Authorization', auth)
        .send(
          body({ accountId: otherAccountId, categoryId: categories.salary }),
        );
      expectError(others, 400, 'ACCOUNT_NOT_FOUND', 'accountId');
    });

    it.each([
      ['名稱空白', { name: '   ' }, 'NAME_INVALID', 'name'],
      ['名稱 31 字', { name: '房'.repeat(31) }, 'NAME_INVALID', 'name'],
      ['金額 0', { amount: '0' }, 'AMOUNT_NOT_POSITIVE', 'amount'],
      ['金額 3 位小數', { amount: '1.234' }, 'AMOUNT_INVALID', 'amount'],
      ['金額送 JSON 數字', { amount: 15000 }, 'AMOUNT_INVALID', 'amount'],
      [
        '到期日 2026-02-30',
        { dueDate: '2026-02-30' },
        'VALIDATION_FAILED',
        'dueDate',
      ],
      [
        '週期不在選項內',
        { recurrence: 'weekly' },
        'VALIDATION_FAILED',
        'recurrence',
      ],
      ['週期傳 null', { recurrence: null }, 'VALIDATION_FAILED', 'recurrence'],
      [
        '帳戶 ID 不是 UUID',
        { accountId: 'abc' },
        'ACCOUNT_NOT_FOUND',
        'accountId',
      ],
      ['請求帶後端決定的 dueDay', { dueDay: 1 }, 'VALIDATION_FAILED', 'dueDay'],
      ['請求帶 status', { status: 'paid' }, 'VALIDATION_FAILED', 'status'],
    ] as const)(
      '%s → 400 %s（US-B24）',
      async (_name, overrides, code, field) => {
        const res = await http()
          .post('/api/v1/bills')
          .set('Authorization', auth)
          .send(body(overrides));
        expectError(res, 400, code, field);
        expect(await prisma.bill.count()).toBe(0);
      },
    );

    it.each([
      ['name', 'NAME_INVALID'],
      ['amount', 'AMOUNT_INVALID'],
      ['categoryId', 'CATEGORY_NOT_FOUND'],
      ['accountId', 'ACCOUNT_NOT_FOUND'],
      ['dueDate', 'VALIDATION_FAILED'],
    ] as const)('必填欄位 %s 沒帶 → 400 %s', async (field, code) => {
      const { [field]: _omit, ...rest } = body();
      const res = await http()
        .post('/api/v1/bills')
        .set('Authorization', auth)
        .send(rest);
      expectError(res, 400, code, field);
      expect(await prisma.bill.count()).toBe(0);
    });

    it.each([
      [
        '分類 ID 不是 UUID',
        { categoryId: 'abc' },
        'CATEGORY_NOT_FOUND',
        'categoryId',
      ],
      [
        '金額整數 13 位',
        { amount: '1000000000000' },
        'AMOUNT_INVALID',
        'amount',
      ],
      ['備註 201 字', { note: '備'.repeat(201) }, 'VALIDATION_FAILED', 'note'],
    ] as const)('%s → 400 %s', async (_name, overrides, code, field) => {
      const res = await http()
        .post('/api/v1/bills')
        .set('Authorization', auth)
        .send(body(overrides));
      expectError(res, 400, code, field);
    });

    it('金額整數 12 位、備註 200 字可以', async () => {
      const bill = await create({
        amount: '999999999999.99',
        note: '備'.repeat(200),
      });
      expect(bill.amount).toBe('999999999999.99');
    });
  });

  describe('GET /bills/:id', () => {
    it('取得自己的帳單，內容跟新增時回的一樣', async () => {
      const bill = await create();
      const res = await http()
        .get(`/api/v1/bills/${bill.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual(bill);
    });

    it('已繳的帳單也可以讀', async () => {
      const { sep } = await rentSeries();
      const res = await http()
        .get(`/api/v1/bills/${sep.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'paid',
        paidAmount: '15000.00',
        paidDate: '2026-09-01',
        isOverdue: false,
      });
    });

    it('台北跨日才算逾期：10/31 到期的帳單，台北 10/31 23:59 不逾期、11/1 00:00 逾期', async () => {
      const bill = await create({ dueDate: '2026-10-31' });
      const isOverdue = async () =>
        (
          (
            await http()
              .get(`/api/v1/bills/${bill.id}`)
              .set('Authorization', auth)
              .expect(200)
          ).body as Bill
        ).isOverdue;
      clock.set('2026-10-31T15:59:59Z');
      expect(await isOverdue()).toBe(false);
      clock.set('2026-10-31T16:00:00Z');
      expect(await isOverdue()).toBe(true);
    });
  });

  describe('PATCH /bills/:id（待繳）', () => {
    it('31 號改成 15 號：dueDay 跟著改成 15（US-B14）', async () => {
      const bill = await create({ dueDate: '2026-12-31' });
      const res = await patch(bill.id, { dueDate: '2026-12-15' }).expect(200);
      expect(res.body).toMatchObject({ dueDate: '2026-12-15', dueDay: 15 });
    });

    it('整份送出、到期日沒變：dueDay 保持原值（2/28 那期的 dueDay 是 31，只改備註不會變成 28）', async () => {
      const bill = await create({ dueDate: '2027-02-28' });
      await prisma.bill.update({
        where: { id: bill.id },
        data: { dueDay: 31 },
      });
      const res = await patch(bill.id, {
        ...body({ dueDate: '2027-02-28' }),
        note: '改備註',
      }).expect(200);
      expect(res.body).toMatchObject({
        dueDate: '2027-02-28',
        dueDay: 31,
        note: '改備註',
      });
    });

    it('改週期：none → monthly → yearly（取目前到期日的月）→ monthly，dueDay 不變（US-B22）', async () => {
      const bill = await create({ dueDate: '2026-12-31', recurrence: 'none' });
      const steps: [string, number | null][] = [
        ['monthly', null],
        ['yearly', 12],
        ['monthly', null],
      ];
      for (const [recurrence, dueMonth] of steps) {
        const res = await patch(bill.id, { recurrence }).expect(200);
        expect(res.body).toMatchObject({ recurrence, dueMonth, dueDay: 31 });
      }
    });

    it.each([
      ['yearly → none', 'yearly', 'none'],
      ['monthly → none', 'monthly', 'none'],
    ] as const)(
      '改週期 %s：dueMonth 是 null（US-B22）',
      async (_name, from, to) => {
        const bill = await create({ dueDate: '2026-12-31', recurrence: from });
        const res = await patch(bill.id, { recurrence: to }).expect(200);
        expect(res.body).toMatchObject({
          recurrence: to,
          dueMonth: null,
          dueDay: 31,
        });
      },
    );

    it('2/28 那期（dueDay 31）改成 2/25：到期日有變，dueDay 改成 25', async () => {
      const bill = await create({ dueDate: '2027-02-28' });
      await prisma.bill.update({
        where: { id: bill.id },
        data: { dueDay: 31 },
      });
      const res = await patch(bill.id, { dueDate: '2027-02-25' }).expect(200);
      expect(res.body).toMatchObject({ dueDate: '2027-02-25', dueDay: 25 });
    });

    it('每年帳單 2/28 那期（dueDay 29）整份送出、到期日沒變：dueDay 保持 29、dueMonth 保持 2', async () => {
      const bill = await create({
        dueDate: '2029-02-28',
        recurrence: 'yearly',
      });
      await prisma.bill.update({
        where: { id: bill.id },
        data: { dueDay: 29 },
      });
      const res = await patch(bill.id, {
        ...body({ dueDate: '2029-02-28', recurrence: 'yearly' }),
        note: '閏年是 2/29',
      }).expect(200);
      expect(res.body).toMatchObject({ dueDay: 29, dueMonth: 2 });
    });

    it('每年帳單改到期日：dueMonth、dueDay 都改成新日期的', async () => {
      const bill = await create({
        dueDate: '2027-02-28',
        recurrence: 'yearly',
      });
      const res = await patch(bill.id, { dueDate: '2027-03-15' }).expect(200);
      expect(res.body).toMatchObject({ dueDay: 15, dueMonth: 3 });
    });

    it('同時改到期日與週期：用新的到期日算 dueMonth', async () => {
      const bill = await create({
        dueDate: '2026-11-01',
        recurrence: 'monthly',
      });
      const res = await patch(bill.id, {
        dueDate: '2027-05-20',
        recurrence: 'yearly',
      }).expect(200);
      expect(res.body).toMatchObject({ dueDay: 20, dueMonth: 5 });
    });

    it('改金額與扣款帳戶（US-B20）', async () => {
      const bill = await create();
      const res = await patch(bill.id, {
        amount: '15500',
        accountId: cashId,
      }).expect(200);
      expect(res.body).toMatchObject({ amount: '15500.00', accountId: cashId });
    });

    it.each([
      [
        '停用的帳戶',
        () => ({ accountId: inactiveId }),
        409,
        'ACCOUNT_INACTIVE',
        'accountId',
      ],
      [
        '別人的帳戶',
        () => ({ accountId: otherAccountId }),
        400,
        'ACCOUNT_NOT_FOUND',
        'accountId',
      ],
      [
        '收入分類',
        () => ({ categoryId: categories.salary }),
        400,
        'CATEGORY_TYPE_MISMATCH',
        'categoryId',
      ],
      [
        '帳戶、分類都改：先檢查帳戶',
        () => ({ accountId: otherAccountId, categoryId: categories.salary }),
        400,
        'ACCOUNT_NOT_FOUND',
        'accountId',
      ],
      [
        '帳戶、分類都改，帳戶沒問題：照樣檢查分類',
        () => ({ accountId: cashId, categoryId: categories.salary }),
        400,
        'CATEGORY_TYPE_MISMATCH',
        'categoryId',
      ],
      [
        '不存在的分類',
        () => ({ categoryId: MISSING_ID }),
        400,
        'CATEGORY_NOT_FOUND',
        'categoryId',
      ],
    ] as const)(
      '改成%s → %i %s（US-B17）',
      async (_name, data, status, code, field) => {
        const bill = await create();
        expectError(await patch(bill.id, data()), status, code, field);
        const row = await prisma.bill.findUniqueOrThrow({
          where: { id: bill.id },
        });
        expect(row.accountId).toBe(bankId);
        expect(row.categoryId).toBe(categories.housing);
      },
    );

    it('帳戶、分類都改成可以用的：200', async () => {
      const bill = await create();
      const res = await patch(bill.id, {
        accountId: cashId,
        categoryId: categories.living,
      }).expect(200);
      expect(res.body).toMatchObject({
        accountId: cashId,
        categoryId: categories.living,
      });
    });

    it('改成別人的自訂分類、自己停用的自訂分類 → CATEGORY_NOT_FOUND，資料不變（US-B17、Q17）', async () => {
      const othersCategory = await createCategory(
        prisma,
        'others-pet',
        CategoryType.expense,
        { userId: otherId },
      );
      const inactiveCategory = await createCategory(
        prisma,
        'my-pet',
        CategoryType.expense,
        { userId, isActive: false },
      );
      const bill = await create();
      for (const categoryId of [othersCategory, inactiveCategory]) {
        expectError(
          await patch(bill.id, { categoryId }),
          400,
          'CATEGORY_NOT_FOUND',
          'categoryId',
        );
      }
      const row = await prisma.bill.findUniqueOrThrow({
        where: { id: bill.id },
      });
      expect(row.categoryId).toBe(categories.housing);
    });

    it('分類之後被停用：整份送出只改備註照樣成功，分類沒變就不檢查（Q17）', async () => {
      const pet = await createCategory(prisma, 'pet', CategoryType.expense, {
        userId,
      });
      const bill = await create({ name: '貓咪保險', categoryId: pet });
      await prisma.category.update({
        where: { id: pet },
        data: { isActive: false },
      });
      const res = await patch(bill.id, {
        ...body({ name: '貓咪保險', categoryId: pet }),
        note: '分類停用了',
      }).expect(200);
      expect(res.body).toMatchObject({ categoryId: pet, note: '分類停用了' });
    });

    it('帳戶之後被停用：整份送出只改備註照樣成功，帳戶沒變就不檢查', async () => {
      const bill = await create();
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      const res = await patch(bill.id, {
        ...body(),
        note: '換帳戶前先記一下',
      }).expect(200);
      expect(res.body).toMatchObject({
        accountId: bankId,
        note: '換帳戶前先記一下',
      });
    });

    it('帳戶已停用、只改分類：只檢查分類，不回 ACCOUNT_INACTIVE', async () => {
      const bill = await create();
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      const res = await patch(bill.id, {
        categoryId: categories.living,
      }).expect(200);
      expect(res.body).toMatchObject({ categoryId: categories.living });
    });

    it('note 傳 null 清空；沒傳的欄位保持原值', async () => {
      const bill = await create({ note: '每月 1 日' });
      const res = await patch(bill.id, { note: null }).expect(200);
      expect(res.body).toMatchObject({
        note: null,
        name: '房租',
        amount: '15000.00',
      });
    });

    it.each([
      ['name', 'NAME_INVALID'],
      ['amount', 'AMOUNT_INVALID'],
      ['dueDate', 'VALIDATION_FAILED'],
      ['accountId', 'ACCOUNT_NOT_FOUND'],
    ] as const)('%s 傳 null → 400 %s', async (field, code) => {
      const bill = await create();
      expectError(await patch(bill.id, { [field]: null }), 400, code, field);
    });

    it('到期日改成剛好今天加 50 年可以；再晚 1 天 → VALIDATION_FAILED（dueDate）', async () => {
      const bill = await create();
      await patch(bill.id, { dueDate: '2076-10-28' }).expect(200);
      expectError(
        await patch(bill.id, { dueDate: '2076-10-29' }),
        400,
        'VALIDATION_FAILED',
        'dueDate',
      );
    });

    it('到期日必須晚於同系列最後一張已繳的到期日：10/1 已繳，11/1 那期改成 10/1 不行、10/2 可以', async () => {
      const { nov } = await rentSeries();
      for (const dueDate of ['2026-10-01', '2026-09-15']) {
        expectError(
          await patch(nov.id, { dueDate }),
          400,
          'VALIDATION_FAILED',
          'dueDate',
        );
      }
      const res = await patch(nov.id, { dueDate: '2026-10-02' }).expect(200);
      expect(res.body).toMatchObject({ dueDate: '2026-10-02', dueDay: 2 });
    });

    it('到期日沒變就不檢查範圍：資料庫裡已經超過 50 年的帳單，只改備註照樣成功', async () => {
      const bill = await create();
      await prisma.bill.update({
        where: { id: bill.id },
        data: { dueDate: toDbDate('2090-01-01') },
      });
      await patch(bill.id, {
        ...body({ dueDate: '2090-01-01' }),
        note: 'x',
      }).expect(200);
    });
  });

  describe('PATCH /bills/:id（已繳）', () => {
    it.each([
      ['金額', () => ({ amount: '14000' })],
      ['分類', () => ({ categoryId: categories.living })],
      ['帳戶', () => ({ accountId: cashId })],
      // 已繳不檢查帳戶：回 BILL_ALREADY_PAID，不是 ACCOUNT_INACTIVE
      ['帳戶（改成停用的帳戶）', () => ({ accountId: inactiveId })],
      ['到期日', () => ({ dueDate: '2026-09-02' })],
      ['週期', () => ({ recurrence: 'yearly' })],
      ['名稱和金額一起改', () => ({ name: '9 月房租', amount: '14000' })],
    ] as const)(
      '改%s → 409 BILL_ALREADY_PAID，資料不變（US-B21）',
      async (_name, data) => {
        const { sep } = await rentSeries();
        const get = () =>
          http()
            .get(`/api/v1/bills/${sep.id}`)
            .set('Authorization', auth)
            .expect(200);
        const before = (await get()).body as Bill;
        expectError(await patch(sep.id, data()), 409, 'BILL_ALREADY_PAID');
        expect((await get()).body).toEqual(before);
      },
    );

    it('只能改名稱與備註（US-B21）', async () => {
      const { sep } = await rentSeries();
      const res = await patch(sep.id, {
        name: '9 月房租',
        note: '晚 2 天繳',
      }).expect(200);
      expect(res.body).toMatchObject({
        name: '9 月房租',
        note: '晚 2 天繳',
        status: 'paid',
        amount: '15000.00',
      });
    });

    it("整份送出、其他欄位的值相同時不報錯：'15000' 等於 '15000.00'", async () => {
      const { sep } = await rentSeries();
      const res = await patch(sep.id, {
        ...body({ dueDate: '2026-09-01', amount: '15000' }),
        name: '9 月房租',
      }).expect(200);
      expect(res.body).toMatchObject({ name: '9 月房租', amount: '15000.00' });
    });

    it('扣款帳戶之後被停用：已繳帳單改名稱照樣成功（不檢查帳戶）', async () => {
      const { sep } = await rentSeries();
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      await patch(sep.id, {
        ...body({ dueDate: '2026-09-01' }),
        name: '舊房租',
      }).expect(200);
    });
  });

  describe('DELETE /bills/:id', () => {
    it('刪除待繳的最新一期：204，之後查不到；已繳的歷史保留（US-B27）', async () => {
      const { sep, oct, nov } = await rentSeries();
      await http()
        .delete(`/api/v1/bills/${nov.id}`)
        .set('Authorization', auth)
        .expect(204);
      await http()
        .get(`/api/v1/bills/${nov.id}`)
        .set('Authorization', auth)
        .expect(404);
      const rows = await prisma.bill.findMany({
        where: { seriesId: sep.seriesId },
        select: { id: true, status: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.id).sort()).toEqual([sep.id, oct.id].sort());
      expect(rows.every((r) => r.status === BillStatus.paid)).toBe(true);
    });

    it('已繳的帳單 → 409 BILL_ALREADY_PAID，沒有刪除（US-B27）', async () => {
      const { oct } = await rentSeries();
      const res = await http()
        .delete(`/api/v1/bills/${oct.id}`)
        .set('Authorization', auth);
      expectError(res, 409, 'BILL_ALREADY_PAID');
      expect(await prisma.bill.count({ where: { id: oct.id } })).toBe(1);
    });

    // 規格 6：鎖定系列後要重新讀取，等鎖的期間被刪掉的帳單回 404，不是 500
    it('同時送兩個 DELETE：一個 204、一個 404，不會 500', async () => {
      const bill = await create();
      const del = () =>
        http().delete(`/api/v1/bills/${bill.id}`).set('Authorization', auth);
      const results = await Promise.all([del(), del()]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        204, 404,
      ]);
      expect(await prisma.bill.count({ where: { id: bill.id } })).toBe(0);
    });

    it('同時送 PATCH 與 DELETE：DELETE 一定成功，PATCH 是 200（先到）或 404（後到）', async () => {
      const bill = await create();
      const [patched, deleted] = await Promise.all([
        patch(bill.id, { note: '同時改' }),
        http().delete(`/api/v1/bills/${bill.id}`).set('Authorization', auth),
      ]);
      expect(deleted.status).toBe(204);
      expect([200, 404]).toContain(patched.status);
      if (patched.status === 404) {
        expect(patched.body).toMatchObject({ code: 'BILL_NOT_FOUND' });
      }
      expect(await prisma.bill.count({ where: { id: bill.id } })).toBe(0);
    });
  });

  describe('GET /bills（列表）', () => {
    /**
     * 房租：9/1、10/1 已繳，11/1 待繳；手機費 10/25 逾期；保險 12/5 待繳；別人的帳單一張。
     * 預設排序：待繳依到期日由近到遠（10/25、11/1、12/5），已繳依到期日由新到舊（10/1、9/1）。
     */
    const seed = async () => {
      const rent = await rentSeries();
      const phone = await create({ name: '手機費', dueDate: '2026-10-25' });
      const insurance = await create({ name: '保險', dueDate: '2026-12-05' });
      await http()
        .post('/api/v1/bills')
        .set('Authorization', otherAuth)
        .send(body({ accountId: otherAccountId, dueDate: '2026-10-26' }))
        .expect(201);
      return { ...rent, phone, insurance };
    };

    it('預設：待繳在前（由近到遠）、已繳在後（由新到舊）；只列自己的；isOverdue 只有逾期的待繳（US-B18）', async () => {
      await seed();
      const l = await list();
      expect(dueDates(l)).toEqual([
        '2026-10-25',
        '2026-11-01',
        '2026-12-05',
        '2026-10-01',
        '2026-09-01',
      ]);
      expect(l.items.map((b) => b.isOverdue)).toEqual([
        true,
        false,
        false,
        false,
        false,
      ]);
      expect(l).toMatchObject({ page: 1, pageSize: 20, total: 5 });
    });

    it.each([
      [
        'pending：逾期的也算待繳',
        'pending',
        ['2026-10-25', '2026-11-01', '2026-12-05'],
      ],
      ['overdue：待繳且到期日早於今天', 'overdue', ['2026-10-25']],
      ['paid：由新到舊', 'paid', ['2026-10-01', '2026-09-01']],
    ])('status=%s', async (_name, status, expected) => {
      await seed();
      const l = await list(`?status=${status}`);
      expect(dueDates(l)).toEqual(expected);
      expect(l.total).toBe(expected.length);
    });

    it('今天到期的待繳帳單不算逾期：status=overdue 不列、status=pending 列出，isOverdue 是 false', async () => {
      const yesterday = await create({ name: '昨天', dueDate: '2026-10-27' });
      const today = await create({ name: '今天', dueDate: TODAY });
      expect((await list('?status=overdue')).items.map((b) => b.id)).toEqual([
        yesterday.id,
      ]);
      const pending = await list('?status=pending');
      expect(pending.items.map((b) => [b.id, b.isOverdue])).toEqual([
        [yesterday.id, true],
        [today.id, false],
      ]);
    });

    it('前端待繳分頁籤的組合 status=pending&pageSize=100：超過預設 20 筆的待繳也一次拿完', async () => {
      await seed();
      for (let i = 1; i <= 22; i += 1) {
        await create({ name: `帳單 ${i}`, dueDate: '2026-11-20' });
      }
      const l = await list('?status=pending&pageSize=100');
      expect(l).toMatchObject({ pageSize: 100, total: 25 });
      expect(l.items).toHaveLength(25);
      expect(l.items.every((b) => b.status === 'pending')).toBe(true);
      // 預設的 pageSize 20 拿不完，確認上面真的有超過一頁
      expect((await list('?status=pending')).items).toHaveLength(20);
    });

    it('指定 status 時的第 2 頁：只在那一組裡分頁', async () => {
      await seed();
      expect(dueDates(await list('?status=paid&page=2&pageSize=1'))).toEqual([
        '2026-09-01',
      ]);
      expect(dueDates(await list('?status=pending&page=2&pageSize=2'))).toEqual(
        ['2026-12-05'],
      );
      const overdue = await list('?status=overdue&page=2&pageSize=1');
      expect(overdue).toMatchObject({ items: [], total: 1 });
    });

    it('dueFrom 等於 dueTo 可以：只列那一天到期的', async () => {
      await seed();
      expect(
        dueDates(await list('?dueFrom=2026-11-01&dueTo=2026-11-01')),
      ).toEqual(['2026-11-01']);
    });

    it('dueFrom、dueTo 篩選的是到期日，含頭尾；也可以跟 status 一起用', async () => {
      await seed();
      expect(
        dueDates(await list('?dueFrom=2026-10-01&dueTo=2026-11-01')),
      ).toEqual(['2026-10-25', '2026-11-01', '2026-10-01']);
      expect(dueDates(await list('?dueFrom=2026-11-02'))).toEqual([
        '2026-12-05',
      ]);
      expect(dueDates(await list('?dueTo=2026-09-01'))).toEqual(['2026-09-01']);
      expect(dueDates(await list('?status=overdue&dueTo=2026-10-24'))).toEqual(
        [],
      );
      expect(dueDates(await list('?status=paid&dueFrom=2026-09-02'))).toEqual([
        '2026-10-01',
      ]);
    });

    it('分頁跨過待繳與已繳的交界：每頁 2 筆，接起來跟不分頁一樣，total 都是 5', async () => {
      await seed();
      const pages: string[][] = [];
      for (let page = 1; page <= 4; page += 1) {
        const l = await list(`?page=${page}&pageSize=2`);
        expect(l).toMatchObject({ page, pageSize: 2, total: 5 });
        pages.push(dueDates(l));
      }
      expect(pages).toEqual([
        ['2026-10-25', '2026-11-01'],
        ['2026-12-05', '2026-10-01'],
        ['2026-09-01'],
        [],
      ]);
    });

    it('到期日相同時依 id 排序', async () => {
      const a = await create({ name: 'A', dueDate: '2026-11-10' });
      const b = await create({ name: 'B', dueDate: '2026-11-10' });
      const l = await list();
      expect(l.items.map((x) => x.id)).toEqual([a.id, b.id].sort());
    });

    it('沒有帳單：items 是空的，total 0', async () => {
      expect(await list()).toEqual({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      });
    });

    it.each([
      ['dueFrom 晚於 dueTo', '?dueFrom=2026-11-02&dueTo=2026-11-01', 'dueFrom'],
      ['status 不在選項內', '?status=late', 'status'],
      ['dueFrom 不是日期', '?dueFrom=2026-02-30', 'dueFrom'],
      ['pageSize 超過 100', '?pageSize=101', 'pageSize'],
      ['page 是 0', '?page=0', 'page'],
    ])('%s → 400 VALIDATION_FAILED', async (_name, query, field) => {
      const res = await http()
        .get(`/api/v1/bills${query}`)
        .set('Authorization', auth);
      expectError(res, 400, 'VALIDATION_FAILED', field);
    });
  });

  describe('他人的帳單與不合法的 :id（US-B29）', () => {
    it.each([
      ['get', '/api/v1/bills'],
      ['post', '/api/v1/bills'],
      ['get', `/api/v1/bills/${MISSING_ID}`],
      ['patch', `/api/v1/bills/${MISSING_ID}`],
      ['delete', `/api/v1/bills/${MISSING_ID}`],
    ] as const)(
      '%s %s 不帶 token → 401 AUTH_UNAUTHENTICATED',
      async (method, path) => {
        const res = await http()[method](path).send(body());
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
      },
    );

    it('別人的帳單：讀取、修改、刪除都回 404，資料不變', async () => {
      const bill = await create();
      // 要用的時候才建立請求：supertest 的請求建立後就會開始連線
      for (const send of [
        () => http().get(`/api/v1/bills/${bill.id}`),
        () => http().patch(`/api/v1/bills/${bill.id}`).send({ name: '偷改' }),
        () => http().delete(`/api/v1/bills/${bill.id}`),
      ]) {
        expectError(
          await send().set('Authorization', otherAuth),
          404,
          'BILL_NOT_FOUND',
        );
      }
      const row = await prisma.bill.findUniqueOrThrow({
        where: { id: bill.id },
      });
      expect(row.name).toBe('房租');
    });

    it.each(['get', 'patch', 'delete'] as const)(
      '%s 不存在的帳單 → 404',
      async (method) => {
        const res = await http()
          [method](`/api/v1/bills/${MISSING_ID}`)
          .set('Authorization', auth)
          .send({ name: '房租' });
        expectError(res, 404, 'BILL_NOT_FOUND');
      },
    );

    it.each([
      ['get', '/api/v1/bills/not-a-uuid'],
      ['patch', '/api/v1/bills/not-a-uuid'],
      ['delete', '/api/v1/bills/not-a-uuid'],
      ['post', '/api/v1/bills/not-a-uuid/pay'],
      ['post', '/api/v1/bills/not-a-uuid/unpay'],
      ['post', '/api/v1/bills/not-a-uuid/stop-recurrence'],
    ] as const)('%s %s → 404 BILL_NOT_FOUND', async (method, path) => {
      const res = await http()[method](path).set('Authorization', auth);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        code: 'BILL_NOT_FOUND',
        message: '找不到這張帳單',
        details: [],
      });
    });
  });

  describe('還沒實作的端點（BILL-5～7）', () => {
    it.each([
      ['pay', undefined],
      ['unpay', undefined],
      ['stop-recurrence', { keepCurrent: true }],
    ] as const)(
      'POST /bills/:id/%s 回 501 NOT_IMPLEMENTED',
      async (action, data) => {
        const res = await http()
          .post(`/api/v1/bills/${MISSING_ID}/${action}`)
          .set('Authorization', auth)
          .send(data)
          .expect(501);
        expect(res.body).toMatchObject({
          code: 'NOT_IMPLEMENTED',
          details: [],
        });
      },
    );

    it('stop-recurrence 沒帶 keepCurrent → 400 VALIDATION_FAILED（keepCurrent）', async () => {
      const res = await http()
        .post(`/api/v1/bills/${MISSING_ID}/stop-recurrence`)
        .set('Authorization', auth);
      expectError(res, 400, 'VALIDATION_FAILED', 'keepCurrent');
    });
  });
});
