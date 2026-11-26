import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { DASHBOARD_REPORT_BLOCKS } from '../src/modules/dashboard/dto/dashboard-block.enum.js';
import { PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

const PATH = '/api/v1/dashboard/layout';

describe('Dashboard 自選顯示區塊 GET／PUT /dashboard/layout（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;

  const api = () => request(app.getHttpServer());
  const get = (token = auth) => api().get(PATH).set('Authorization', token);
  const put = (body: unknown, token = auth) =>
    api()
      .put(PATH)
      .set('Authorization', token)
      .send(body as object);
  const stored = async (id = userId) =>
    (
      await prisma.user.findUniqueOrThrow({
        where: { id },
        select: { dashboardHiddenBlocks: true },
      })
    ).dashboardHiddenBlocks;

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate('2026-10-28');
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'e-layout@example.com');
    auth = await bearer(app, userId);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET', () => {
    it('新使用者：[]（全部顯示）', async () => {
      const res = await get().expect(200);
      expect(res.body).toEqual({ hiddenBlocks: [] });
    });

    it('資料庫裡的舊代碼會被過濾，並依固定順序回傳', async () => {
      await prisma.user.update({
        where: { id: userId },
        data: { dashboardHiddenBlocks: ['trend', 'old-block', 'loans'] },
      });
      const res = await get().expect(200);
      expect(res.body).toEqual({ hiddenBlocks: ['loans', 'trend'] });
    });

    it('沒帶 token → 401', async () => {
      await api().get(PATH).expect(401);
    });

    it('token 對應的使用者不存在 → 401 AUTH_UNAUTHENTICATED', async () => {
      await prisma.user.delete({ where: { id: userId } });
      const res = await get().expect(401);
      expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    });
  });

  describe('PUT', () => {
    it('存起來後 GET 拿到同樣的清單', async () => {
      const res = await put({ hiddenBlocks: ['loans', 'trend'] }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: ['loans', 'trend'] });
      expect((await get().expect(200)).body).toEqual({
        hiddenBlocks: ['loans', 'trend'],
      });
    });

    it('順序打亂 → 依固定順序存與回傳', async () => {
      const res = await put({ hiddenBlocks: ['trend', 'loans'] }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: ['loans', 'trend'] });
      expect(await stored()).toEqual(['loans', 'trend']);
    });

    it('重複的代碼 → 去重後存檔', async () => {
      const res = await put({ hiddenBlocks: ['loans', 'loans'] }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: ['loans'] });
      expect(await stored()).toEqual(['loans']);
      expect((await get().expect(200)).body).toEqual({
        hiddenBlocks: ['loans'],
      });
    });

    it('[] → 全部顯示', async () => {
      await put({ hiddenBlocks: ['loans'] }).expect(200);
      const res = await put({ hiddenBlocks: [] }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: [] });
      expect(await stored()).toEqual([]);
    });

    it('第一屏 2 個全部隱藏 → 可以', async () => {
      const res = await put({
        hiddenBlocks: ['today-bills', 'cash-gap'],
      }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: ['today-bills', 'cash-gap'] });
    });

    it('報表只留 1 個 → 可以', async () => {
      const hidden = DASHBOARD_REPORT_BLOCKS.filter((c) => c !== 'trend');
      const res = await put({ hiddenBlocks: hidden }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: hidden });
    });

    it.each([
      ['不認得的代碼', { hiddenBlocks: ['unknown'] }],
      ['固定區塊 next-step', { hiddenBlocks: ['next-step'] }],
      ['大小寫不對', { hiddenBlocks: ['LOANS'] }],
      ['元素不是字串', { hiddenBlocks: [1] }],
      ['沒帶 hiddenBlocks', {}],
      ['不是陣列', { hiddenBlocks: 'loans' }],
      ['null', { hiddenBlocks: null }],
      ['多帶欄位', { hiddenBlocks: [], order: [] }],
      ['超過 20 個元素', { hiddenBlocks: Array<string>(21).fill('loans') }],
    ])('%s → 400 VALIDATION_FAILED，設定不變', async (_, body) => {
      await put({ hiddenBlocks: ['loans'] }).expect(200);
      const res = await put(body).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await stored()).toEqual(['loans']);
    });

    it('不認得的代碼：field 是 hiddenBlocks', async () => {
      const res = await put({ hiddenBlocks: ['loans', 'unknown'] }).expect(400);
      expect((res.body as { details: unknown }).details).toEqual([
        expect.objectContaining({
          field: 'hiddenBlocks',
          code: 'VALIDATION_FAILED',
        }),
      ]);
    });

    it('剛好 20 個元素（去重後 1 個）→ 可以', async () => {
      const res = await put({
        hiddenBlocks: Array<string>(20).fill('loans'),
      }).expect(200);
      expect(res.body).toEqual({ hiddenBlocks: ['loans'] });
    });

    it('報表 5 個全部隱藏 → 400 DASHBOARD_REPORT_REQUIRED，設定不變', async () => {
      await put({ hiddenBlocks: ['loans'] }).expect(200);
      const res = await put({
        hiddenBlocks: ['today-bills', ...DASHBOARD_REPORT_BLOCKS],
      }).expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'DASHBOARD_REPORT_REQUIRED',
        message: '報表至少要留一個區塊',
        details: [
          expect.objectContaining({
            field: 'hiddenBlocks',
            code: 'DASHBOARD_REPORT_REQUIRED',
          }),
        ],
      });
      expect(await stored()).toEqual(['loans']);
    });

    it('報表 5 個各重複一次 → 仍是 400 DASHBOARD_REPORT_REQUIRED', async () => {
      const res = await put({
        hiddenBlocks: [...DASHBOARD_REPORT_BLOCKS, ...DASHBOARD_REPORT_BLOCKS],
      }).expect(400);
      expect(res.body).toMatchObject({ code: 'DASHBOARD_REPORT_REQUIRED' });
    });

    it('A 使用者的設定不影響 B 使用者', async () => {
      const otherId = await createUser(prisma, 'e-layout-other@example.com');
      const otherAuth = await bearer(app, otherId);
      await put({ hiddenBlocks: ['loans'] }).expect(200);
      expect((await get(otherAuth).expect(200)).body).toEqual({
        hiddenBlocks: [],
      });
      expect(await stored(otherId)).toEqual([]);
    });

    it('沒帶 token → 401', async () => {
      await api().put(PATH).send({ hiddenBlocks: [] }).expect(401);
    });

    it('token 對應的使用者不存在 → 401 AUTH_UNAUTHENTICATED', async () => {
      await prisma.user.delete({ where: { id: userId } });
      const res = await put({ hiddenBlocks: ['loans'] }).expect(401);
      expect(res.body).toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
    });

    it('隱藏區塊不影響 /dashboard/summary', async () => {
      const summary = () =>
        api()
          .get('/api/v1/dashboard/summary')
          .set('Authorization', auth)
          .expect(200);
      const before: unknown = (await summary()).body;
      await put({
        hiddenBlocks: ['today-bills', 'upcoming-bills', 'loans'],
      }).expect(200);
      expect((await summary()).body).toEqual(before);
    });
  });
});
