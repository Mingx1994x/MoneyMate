import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { AccountsService } from '../src/modules/accounts/index.js';
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
const NOT_EXIST = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('帳戶 API（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accounts: AccountsService;
  let userId: string;
  let auth: string;

  const api = () => request(app.getHttpServer());
  /** 回應的 items 依序取出名稱（res.body 是 any，先收窄型別） */
  const names = (body: unknown) =>
    (body as { items: { name: string }[] }).items.map((a) => a.name);
  const createEstimate = (openingBalance: string) =>
    prisma.$transaction((tx) =>
      accounts.createAccount(tx, userId, {
        name: '現有資產（估計）',
        accountType: AccountType.bank,
        openingBalance: new Prisma.Decimal(openingBalance),
        isEstimate: true,
      }),
    );

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
    accounts = app.get(AccountsService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-accounts@example.com');
    auth = await bearer(app, userId);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  describe('POST /accounts', () => {
    it('新增銀行帳戶：201，目前餘額＝初始餘額，沒有交易', async () => {
      const res = await api()
        .post('/api/v1/accounts')
        .set('Authorization', auth)
        .send({
          name: '  台新銀行 ',
          accountType: 'bank',
          openingBalance: '100000',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        name: '台新銀行',
        accountType: 'bank',
        currency: 'TWD',
        openingBalance: '100000.00',
        currentBalance: '100000.00',
        isActive: true,
        isEstimate: false,
        deductedFromEstimate: null,
        hasTransactions: false,
        note: null,
      });
      expect(res.body).not.toHaveProperty('userId');
    });

    it('信用卡的初始餘額可以是負數', async () => {
      const res = await api()
        .post('/api/v1/accounts')
        .set('Authorization', auth)
        .send({
          name: '玉山卡',
          accountType: 'credit_card',
          openingBalance: '-30000',
        })
        .expect(201);
      expect(res.body).toMatchObject({ currentBalance: '-30000.00' });
    });

    it.each(['cash', 'bank', 'investment'])(
      '%s 的初始餘額為負數：400 OPENING_BALANCE_NEGATIVE',
      async (accountType) => {
        const res = await api()
          .post('/api/v1/accounts')
          .set('Authorization', auth)
          .send({ name: '帳戶', accountType, openingBalance: '-1' })
          .expect(400);
        expect(res.body).toMatchObject({
          code: 'OPENING_BALANCE_NEGATIVE',
          details: [
            { field: 'openingBalance', code: 'OPENING_BALANCE_NEGATIVE' },
          ],
        });
      },
    );

    it('金額格式不對：400 AMOUNT_INVALID（全域驗證）', async () => {
      const res = await api()
        .post('/api/v1/accounts')
        .set('Authorization', auth)
        .send({ name: '帳戶', accountType: 'bank', openingBalance: '1e5' })
        .expect(400);
      expect(res.body).toMatchObject({ code: 'AMOUNT_INVALID' });
    });
  });

  describe('GET /accounts', () => {
    it('沒有帳戶：items 是空陣列', async () => {
      const res = await api()
        .get('/api/v1/accounts')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual({ items: [] });
    });

    it('目前餘額：收入、支出、轉出、轉入都算，未來日期的交易不算', async () => {
      const bank = await prisma.account.create({
        data: {
          userId,
          name: '銀行',
          accountType: 'bank',
          openingBalance: 100000,
        },
      });
      const card = await prisma.account.create({
        data: {
          userId,
          name: '信用卡',
          accountType: 'credit_card',
          openingBalance: 0,
        },
      });
      const salary = await createCategory(
        prisma,
        'e2e_salary',
        CategoryType.income,
      );
      const food = await createCategory(
        prisma,
        'e2e_food',
        CategoryType.expense,
      );
      const tx = { userId, transactionDate: TODAY };
      await createTransaction(prisma, {
        ...tx,
        accountId: bank.id,
        transactionType: TransactionType.income,
        amount: '50000',
        categoryId: salary,
      });
      await createTransaction(prisma, {
        ...tx,
        accountId: bank.id,
        transactionType: TransactionType.expense,
        amount: '30000',
        categoryId: food,
      });
      await createTransaction(prisma, {
        ...tx,
        accountId: card.id,
        transactionType: TransactionType.expense,
        amount: '20000',
        categoryId: food,
      });
      // 繳卡費：銀行 → 信用卡的轉帳
      await createTransaction(prisma, {
        ...tx,
        accountId: bank.id,
        transactionType: TransactionType.transfer,
        amount: '10000',
        toAccountId: card.id,
      });
      // 明天的薪水：不計入目前餘額（AC-19）
      await createTransaction(prisma, {
        ...tx,
        transactionDate: '2026-10-29',
        accountId: bank.id,
        transactionType: TransactionType.income,
        amount: '99999',
        categoryId: salary,
      });

      const res = await api()
        .get('/api/v1/accounts')
        .set('Authorization', auth)
        .expect(200);
      const { items } = res.body as { items: { name: string }[] };
      const byName = Object.fromEntries(items.map((a) => [a.name, a]));
      // 100000 + 50000 − 30000 − 10000
      expect(byName['銀行']).toMatchObject({
        currentBalance: '110000.00',
        hasTransactions: true,
      });
      // 0 − 20000 + 10000
      expect(byName['信用卡']).toMatchObject({
        currentBalance: '-10000.00',
        hasTransactions: true,
      });
    });

    it('預設不列停用帳戶；includeInactive=true 時列出，排在啟用中的後面', async () => {
      await prisma.account.create({
        data: {
          userId,
          name: '舊帳戶',
          accountType: 'cash',
          openingBalance: 0,
          isActive: false,
        },
      });
      await prisma.account.create({
        data: {
          userId,
          name: '錢包',
          accountType: 'cash',
          openingBalance: 500,
        },
      });

      const active = await api()
        .get('/api/v1/accounts')
        .set('Authorization', auth)
        .expect(200);
      expect(names(active.body)).toEqual(['錢包']);

      const all = await api()
        .get('/api/v1/accounts?includeInactive=true')
        .set('Authorization', auth)
        .expect(200);
      expect(names(all.body)).toEqual(['錢包', '舊帳戶']);
    });

    it('includeInactive 不是 true／false：400 VALIDATION_FAILED', async () => {
      const res = await api()
        .get('/api/v1/accounts?includeInactive=yes')
        .set('Authorization', auth)
        .expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('GET /accounts/:id 與權限', () => {
    it('取得自己的帳戶；停用的也查得到', async () => {
      const a = await prisma.account.create({
        data: {
          userId,
          name: '舊帳戶',
          accountType: 'cash',
          openingBalance: 0,
          isActive: false,
        },
      });
      const res = await api()
        .get(`/api/v1/accounts/${a.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({ id: a.id, isActive: false });
    });

    it('使用者 A 看不到使用者 B 的帳戶：列表沒有、單筆回 404（AC-02）', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const other = await prisma.account.create({
        data: {
          userId: otherId,
          name: 'B 的帳戶',
          accountType: 'bank',
          openingBalance: 1,
        },
      });

      const list = await api()
        .get('/api/v1/accounts')
        .set('Authorization', auth)
        .expect(200);
      expect(list.body).toEqual({ items: [] });

      const res = await api()
        .get(`/api/v1/accounts/${other.id}`)
        .set('Authorization', auth)
        .expect(404);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
    });

    it('不存在：404 ACCOUNT_NOT_FOUND', async () => {
      await api()
        .get(`/api/v1/accounts/${NOT_EXIST}`)
        .set('Authorization', auth)
        .expect(404);
    });
  });

  describe('從估計帳戶扣除（PRD 15.9、AC-18）', () => {
    const post = (openingBalance: string, accountType = 'bank') =>
      api()
        .post('/api/v1/accounts')
        .set('Authorization', auth)
        .send({
          name: '真實帳戶',
          accountType,
          openingBalance,
          deductFromEstimate: true,
        })
        .expect(201);

    it('估計 50 萬，新增 10 萬並扣除：估計剩 40 萬，帳戶合計不變', async () => {
      const estimate = await createEstimate('500000');
      const res = await post('100000');
      expect(res.body).toMatchObject({ deductedFromEstimate: '100000.00' });

      const after = await prisma.account.findUniqueOrThrow({
        where: { id: estimate.id },
      });
      expect(after.openingBalance.toFixed(2)).toBe('400000.00');
      expect(after.isActive).toBe(true);
    });

    it('估計剩 5 萬，新增 10 萬並扣除：只扣 5 萬，估計帳戶自動停用', async () => {
      const estimate = await createEstimate('50000');
      const res = await post('100000');
      expect(res.body).toMatchObject({ deductedFromEstimate: '50000.00' });

      const after = await prisma.account.findUniqueOrThrow({
        where: { id: estimate.id },
      });
      expect(after.openingBalance.toFixed(2)).toBe('0.00');
      expect(after.isActive).toBe(false);
    });

    it('估計帳戶目前餘額 ≤ 0：不扣，deductedFromEstimate 是 null（不違反資料庫約束）', async () => {
      const estimate = await createEstimate('0');
      const res = await post('100000');
      expect(res.body).toMatchObject({ deductedFromEstimate: null });

      const after = await prisma.account.findUniqueOrThrow({
        where: { id: estimate.id },
      });
      expect(after.openingBalance.toFixed(2)).toBe('0.00');
    });

    it('初始餘額 ≤ 0（信用卡）：不扣', async () => {
      await createEstimate('500000');
      const res = await post('-5000', 'credit_card');
      expect(res.body).toMatchObject({ deductedFromEstimate: null });
    });

    it('沒有估計帳戶：照常建立，不扣', async () => {
      const res = await post('100000');
      expect(res.body).toMatchObject({ deductedFromEstimate: null });
    });
  });

  describe('createAccount（給 D 的問卷）', () => {
    it('建立估計帳戶：bank、isEstimate、deductedFromEstimate 是 null', async () => {
      const a = await createEstimate('300000');
      expect(a).toMatchObject({
        accountType: 'bank',
        isEstimate: true,
        deductedFromEstimate: null,
      });
    });

    it('估計帳戶的初始餘額可以是負數', async () => {
      const a = await createEstimate('-100');
      expect(a.openingBalance.toFixed(2)).toBe('-100.00');
    });

    it('同一位使用者第二個估計帳戶：409 CONFLICT', async () => {
      await createEstimate('1');
      await expect(createEstimate('2')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('PATCH /accounts/:id', () => {
    let bankId: string;
    let foodId: string;
    const patch = (id: string, body: Record<string, unknown>) =>
      api()
        .patch(`/api/v1/accounts/${id}`)
        .set('Authorization', auth)
        .send(body);
    const make = async (
      accountType: AccountType,
      openingBalance: string,
      isActive = true,
    ) =>
      (
        await prisma.account.create({
          data: {
            userId,
            name: accountType,
            accountType,
            openingBalance: new Prisma.Decimal(openingBalance),
            isActive,
          },
        })
      ).id;
    const expense = (accountId: string, amount: string, date = TODAY) =>
      createTransaction(prisma, {
        userId,
        accountId,
        transactionType: TransactionType.expense,
        amount,
        categoryId: foodId,
        transactionDate: date,
      });

    beforeEach(async () => {
      bankId = await make(AccountType.bank, '10000');
      foodId = await createCategory(prisma, 'food', CategoryType.expense);
    });

    it('改名稱、備註：沒傳的欄位保持原值', async () => {
      const res = await patch(bankId, { name: ' 台新 ', note: '薪轉' }).expect(
        200,
      );
      expect(res.body).toMatchObject({
        id: bankId,
        name: '台新',
        note: '薪轉',
        accountType: 'bank',
        openingBalance: '10000.00',
        isActive: true,
      });
      const res2 = await patch(bankId, { note: null }).expect(200);
      expect(res2.body).toMatchObject({ name: '台新', note: null });
    });

    it('改初始餘額：目前餘額跟著變（PRD 15.11）', async () => {
      await expense(bankId, '3000');
      const res = await patch(bankId, { openingBalance: '20000' }).expect(200);
      expect(res.body).toMatchObject({
        openingBalance: '20000.00',
        currentBalance: '17000.00',
      });
    });

    it.each([
      ['bank', AccountType.bank, 400],
      ['cash', AccountType.cash, 400],
      ['investment', AccountType.investment, 400],
      ['credit_card', AccountType.credit_card, 200],
    ])('%s 初始餘額改成負數：%i', async (_name, type, status) => {
      const id = await make(type, '0');
      const res = await patch(id, { openingBalance: '-100' }).expect(status);
      if (status === 400) {
        expect(res.body).toMatchObject({
          code: 'OPENING_BALANCE_NEGATIVE',
          details: [{ field: 'openingBalance' }],
        });
      }
    });

    it('估計帳戶的初始餘額可以改成負數', async () => {
      const estimate = await createEstimate('1000');
      await patch(estimate.id, { openingBalance: '-100' }).expect(200);
    });

    it.each([
      ['name', 'NAME_INVALID'],
      ['openingBalance', 'AMOUNT_INVALID'],
      ['isActive', 'VALIDATION_FAILED'],
    ])('%s 傳 null：400 %s', async (field, code) => {
      const res = await patch(bankId, { [field]: null }).expect(400);
      expect(res.body).toMatchObject({ code, details: [{ field }] });
    });

    it('accountType 不能改：400', async () => {
      await patch(bankId, { accountType: 'cash' }).expect(400);
    });

    it('停用：餘額 0、沒有未來交易 → 停用成功，GET 預設不列出', async () => {
      await expense(bankId, '10000');
      const res = await patch(bankId, { isActive: false }).expect(200);
      expect(res.body).toMatchObject({
        isActive: false,
        currentBalance: '0.00',
      });
      const list = await api()
        .get('/api/v1/accounts')
        .set('Authorization', auth)
        .expect(200);
      expect(names(list.body)).not.toContain('bank');
    });

    it('停用：還有餘額 → 409 ACCOUNT_DEACTIVATE_BLOCKED（field isActive），帳戶照舊', async () => {
      const res = await patch(bankId, { isActive: false }).expect(409);
      expect(res.body).toMatchObject({
        code: 'ACCOUNT_DEACTIVATE_BLOCKED',
        details: [{ field: 'isActive' }],
      });
      const row = await prisma.account.findUniqueOrThrow({
        where: { id: bankId },
      });
      expect(row.isActive).toBe(true);
    });

    it('停用：餘額 0 但有未來日期的交易 → 409（AC-03）', async () => {
      await expense(bankId, '10000');
      await createTransaction(prisma, {
        userId,
        accountId: await make(AccountType.cash, '500'),
        toAccountId: bankId,
        transactionType: TransactionType.transfer,
        amount: '500',
        transactionDate: '2026-11-05',
      });
      await patch(bankId, { isActive: false }).expect(409);
    });

    it('同一個請求把初始餘額改成 0 再停用：用改完的餘額判斷', async () => {
      const res = await patch(bankId, {
        openingBalance: '0',
        isActive: false,
      }).expect(200);
      expect(res.body).toMatchObject({
        isActive: false,
        openingBalance: '0.00',
      });
    });

    it('停用被擋時，同一個請求的其他修改也不生效', async () => {
      await patch(bankId, { name: '新名稱', isActive: false }).expect(409);
      const row = await prisma.account.findUniqueOrThrow({
        where: { id: bankId },
      });
      expect(row.name).toBe('bank');
    });

    it('信用卡欠款還沒繳清（餘額負數）也不能停用', async () => {
      const card = await make(AccountType.credit_card, '-500');
      await patch(card, { isActive: false }).expect(409);
    });

    it('停用的帳戶：只帶 isActive = true → 重新啟用', async () => {
      const id = await make(AccountType.bank, '0', false);
      const res = await patch(id, { isActive: true }).expect(200);
      expect(res.body).toMatchObject({ isActive: true });
    });

    it('停用的帳戶：帶了其他欄位 → 409 ACCOUNT_INACTIVE，什麼都沒改（先重新啟用再修改）', async () => {
      const id = await make(AccountType.bank, '0', false);
      for (const body of [
        { name: '改名' },
        { openingBalance: '100' },
        { name: '改名', isActive: true },
      ]) {
        const res = await patch(id, body).expect(409);
        expect(res.body).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
      }
      const row = await prisma.account.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ name: 'bank', isActive: false });
    });

    it('別人的帳戶、不存在的帳戶：404 ACCOUNT_NOT_FOUND', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      const res = await api()
        .patch(`/api/v1/accounts/${bankId}`)
        .set('Authorization', await bearer(app, otherId))
        .send({ name: '偷改' })
        .expect(404);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
      await patch(NOT_EXIST, { name: 'x' }).expect(404);
      const row = await prisma.account.findUniqueOrThrow({
        where: { id: bankId },
      });
      expect(row.name).toBe('bank');
    });

    it('停用後不能再新增它的交易（AC-26）', async () => {
      await expense(bankId, '10000');
      await patch(bankId, { isActive: false }).expect(200);
      const res = await api()
        .post('/api/v1/transactions')
        .set('Authorization', auth)
        .send({
          transactionType: 'expense',
          amount: '1',
          accountId: bankId,
          categoryId: foodId,
        })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_INACTIVE' });
    });
  });

  describe('DELETE /accounts/:id', () => {
    const del = (id: string, query = '') =>
      api().delete(`/api/v1/accounts/${id}${query}`).set('Authorization', auth);
    const make = async (openingBalance = '1000') =>
      (
        await prisma.account.create({
          data: {
            userId,
            name: '銀行',
            accountType: 'bank',
            openingBalance: new Prisma.Decimal(openingBalance),
          },
        })
      ).id;

    it('沒有交易、沒有帳單：204，之後查不到', async () => {
      const id = await make();
      const res = await del(id).expect(204);
      expect(res.body).toEqual({});
      await api()
        .get(`/api/v1/accounts/${id}`)
        .set('Authorization', auth)
        .expect(404);
    });

    it.each([
      ['轉出', 'from'],
      ['轉入', 'to'],
      ['未來日期', 'future'],
    ])('有交易（%s）：409 ACCOUNT_IN_USE，帳戶還在', async (_name, kind) => {
      const id = await make();
      const other = await make();
      await createTransaction(prisma, {
        userId,
        accountId: kind === 'to' ? other : id,
        toAccountId: kind === 'to' ? id : other,
        transactionType: TransactionType.transfer,
        amount: '1',
        transactionDate: kind === 'future' ? '2026-12-01' : TODAY,
      });
      const res = await del(id).expect(409);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_IN_USE', details: [] });
      expect(await prisma.account.count({ where: { id } })).toBe(1);
    });

    it('被帳單使用：409 ACCOUNT_IN_USE', async () => {
      const id = await make();
      const food = await createCategory(prisma, 'food', CategoryType.expense);
      await prisma.bill.create({
        data: {
          userId,
          name: '電話費',
          amount: 500,
          categoryId: food,
          accountId: id,
          dueDate: new Date('2026-11-05T00:00:00Z'),
          dueDay: 5,
        },
      });
      const res = await del(id).expect(409);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_IN_USE' });
    });

    it('別人的帳戶：404，而且沒有被刪掉', async () => {
      const id = await make();
      const otherId = await createUser(prisma, 'c-other@example.com');
      const res = await api()
        .delete(`/api/v1/accounts/${id}`)
        .set('Authorization', await bearer(app, otherId))
        .expect(404);
      expect(res.body).toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
      expect(await prisma.account.count({ where: { id } })).toBe(1);
      await del(NOT_EXIST).expect(404);
    });

    it('停用的帳戶沒有交易時也可以刪', async () => {
      const id = await make('0');
      await prisma.account.update({ where: { id }, data: { isActive: false } });
      await del(id).expect(204);
    });

    it('估計帳戶也可以刪除（D-D-004）', async () => {
      const estimate = await createEstimate('500000');
      await del(estimate.id).expect(204);
    });

    describe('addBackToEstimate（PRD 15.9）', () => {
      const postDeducted = async (openingBalance: string) => {
        const res = await api()
          .post('/api/v1/accounts')
          .set('Authorization', auth)
          .send({
            name: '真實帳戶',
            accountType: 'bank',
            openingBalance,
            deductFromEstimate: true,
          })
          .expect(201);
        return (res.body as { id: string }).id;
      };
      const estimateRow = (id: string) =>
        prisma.account.findUniqueOrThrow({ where: { id } });

      it('true：扣掉的 10 萬加回估計帳戶', async () => {
        const estimate = await createEstimate('500000');
        const id = await postDeducted('100000');
        await del(id, '?addBackToEstimate=true').expect(204);
        const after = await estimateRow(estimate.id);
        expect(after.openingBalance.toFixed(2)).toBe('500000.00');
      });

      it('true：估計帳戶被扣到 0 而停用 → 加回後重新啟用', async () => {
        const estimate = await createEstimate('50000');
        const id = await postDeducted('100000');
        expect((await estimateRow(estimate.id)).isActive).toBe(false);
        await del(id, '?addBackToEstimate=true').expect(204);
        const after = await estimateRow(estimate.id);
        expect(after.openingBalance.toFixed(2)).toBe('50000.00');
        expect(after.isActive).toBe(true);
      });

      it('沒帶或 false：不加回', async () => {
        const estimate = await createEstimate('500000');
        const a = await postDeducted('100000');
        const b = await postDeducted('100000');
        await del(a).expect(204);
        await del(b, '?addBackToEstimate=false').expect(204);
        const after = await estimateRow(estimate.id);
        expect(after.openingBalance.toFixed(2)).toBe('300000.00');
      });

      it('帳戶沒有扣除紀錄：忽略，不加回', async () => {
        const estimate = await createEstimate('500000');
        const id = await make('100000');
        await del(id, '?addBackToEstimate=true').expect(204);
        const after = await estimateRow(estimate.id);
        expect(after.openingBalance.toFixed(2)).toBe('500000.00');
      });

      it('估計帳戶已經刪掉：照常刪除，不報錯', async () => {
        const estimate = await createEstimate('500000');
        const id = await postDeducted('100000');
        await del(estimate.id).expect(204);
        await del(id, '?addBackToEstimate=true').expect(204);
      });

      it('addBackToEstimate 不是布林值：400 VALIDATION_FAILED', async () => {
        const id = await make();
        const res = await del(id, '?addBackToEstimate=yes').expect(400);
        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      });

      it('有交易時就算帶 true 也不加回（整個請求不生效）', async () => {
        const estimate = await createEstimate('500000');
        const id = await postDeducted('100000');
        await createTransaction(prisma, {
          userId,
          accountId: id,
          toAccountId: await make(),
          transactionType: TransactionType.transfer,
          amount: '1',
          transactionDate: TODAY,
        });
        await del(id, '?addBackToEstimate=true').expect(409);
        const after = await estimateRow(estimate.id);
        expect(after.openingBalance.toFixed(2)).toBe('400000.00');
      });
    });
  });

  describe(':id 格式', () => {
    it.each(['get', 'patch', 'delete'] as const)(
      '%s 的 :id 不是 UUID 時回 404 ACCOUNT_NOT_FOUND',
      async (method) => {
        const res = await api()
          [method]('/api/v1/accounts/not-a-uuid')
          .set('Authorization', auth)
          .expect(404);
        expect(res.body).toMatchObject({
          code: 'ACCOUNT_NOT_FOUND',
          details: [],
        });
      },
    );
  });
});
