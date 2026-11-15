import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { PrismaService } from '../src/prisma/index.js';
import { loginUser, registerUser, type TestUser } from './utils/auth.js';
import { createTestApp } from './utils/create-test-app.js';
import { resetDb, seedCategories } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';

/**
 * W2 最小流程（PRD 第 1192 行）：全部走 API，不直接寫資料庫，模擬一個新使用者第一次使用。
 * ① 註冊與登入 ② 建立一個帳戶 ③ 新增一筆收入或支出 ④ Dashboard 顯示正確的本月收支
 * ⑤ 重新整理、重新登入後資料仍在。
 * 每一步依序執行、共用前一步的結果（一個 describe 裡的 it 依序跑）；
 * 前面失敗時後面也會失敗，看第一個失敗的步驟就知道流程斷在哪裡。
 * 部署環境上的驗收由前端的 Playwright 負責（D 的 seed:e2e），這裡確保後端 API 串得起來。
 */
const TODAY = '2026-11-15';

describe('W2 最小流程（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let user: TestUser;
  let bankId: string;

  const api = () => request(app.getHttpServer());
  const get = (path: string, auth = user.auth) =>
    api().get(`/api/v1${path}`).set('Authorization', auth).expect(200);

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    // 部署環境由 seed:categories 建立系統分類；新使用者一開始就看得到
    await seedCategories(prisma);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it('① 註冊後拿到 token，/auth/me 是自己', async () => {
    user = await registerUser(app, { displayName: '小明' });
    const res = await get('/auth/me');
    expect(res.body).toMatchObject({ id: user.id, email: user.email });
  });

  it('② 建立一個銀行帳戶，帳戶列表看得到', async () => {
    const res = await api()
      .post('/api/v1/accounts')
      .set('Authorization', user.auth)
      .send({ name: '薪轉戶', accountType: 'bank', openingBalance: '50000' })
      .expect(201);
    bankId = (res.body as { id: string }).id;

    const list = await get('/accounts');
    expect(list.body).toMatchObject({
      items: [{ id: bankId, name: '薪轉戶', currentBalance: '50000.00' }],
    });
  });

  it('③ 用 API 查到的系統分類，新增一筆收入、一筆支出（日期不帶＝台北今天）', async () => {
    const cats = await get('/categories');
    const idOf = (code: string) => {
      const c = (
        cats.body as { items: { id: string; code: string }[] }
      ).items.find((x) => x.code === code);
      if (!c) throw new Error(`找不到系統分類 ${code}`);
      return c.id;
    };

    const income = await api()
      .post('/api/v1/transactions')
      .set('Authorization', user.auth)
      .send({
        transactionType: 'income',
        amount: '30000',
        accountId: bankId,
        categoryId: idOf('salary'),
      })
      .expect(201);
    expect(income.body).toMatchObject({ transactionDate: TODAY });

    await api()
      .post('/api/v1/transactions')
      .set('Authorization', user.auth)
      .send({
        transactionType: 'expense',
        amount: '1200',
        accountId: bankId,
        categoryId: idOf('food'),
        note: '午餐',
      })
      .expect(201);
  });

  it('④ Dashboard 顯示正確的本月收支、帳戶合計', async () => {
    const res = await get('/dashboard/summary');
    expect(res.body).toMatchObject({
      today: TODAY,
      month: '2026-11',
      income: '30000.00',
      expense: '1200.00',
      savingsRate: 96,
      accountsTotal: '78800.00',
      availableCash: '78800.00',
      hasCashAccounts: true,
    });
  });

  it('⑤ 重新登入（新的 token）後資料仍在', async () => {
    // 重新登入拿新的 token（同一秒內簽發的 token 可能長得一樣，所以不比較字串）
    const auth = await loginUser(app, user.email, user.password);

    const accounts = await get('/accounts', auth);
    expect(accounts.body).toMatchObject({
      items: [{ id: bankId, currentBalance: '78800.00' }],
    });

    const txs = await get('/transactions', auth);
    expect(txs.body).toMatchObject({ total: 2 });

    const summary = await get('/dashboard/summary', auth);
    expect(summary.body).toMatchObject({
      income: '30000.00',
      expense: '1200.00',
    });
  });

  it('另一個新使用者看不到小明的資料', async () => {
    const other = await registerUser(app);
    const accounts = await get('/accounts', other.auth);
    expect(accounts.body).toMatchObject({ items: [] });
    const txs = await get('/transactions', other.auth);
    expect(txs.body).toMatchObject({ total: 0 });
    const summary = await get('/dashboard/summary', other.auth);
    expect(summary.body).toMatchObject({
      income: '0.00',
      expense: '0.00',
      accountsTotal: '0.00',
    });
  });
});
