import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';
import { PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

describe('目標設定 GET／PATCH /goal（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FakeClock;
  let userId: string;
  let auth: string;

  const api = () => request(app.getHttpServer());
  const patch = (body: object) =>
    api().patch('/api/v1/goal').set('Authorization', auth).send(body);
  const onboard = () =>
    app.get(OnboardingService).submit(userId, { monthlySpending: 40000 });

  beforeAll(async () => {
    clock = FakeClock.onTaipeiDate('2026-10-28');
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.setTaipeiDate('2026-10-28');
    await resetDb(prisma);
    userId = await createUser(prisma, 'd-goal@example.com');
    auth = await bearer(app, userId);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('還沒完成問卷', () => {
    it.each([
      ['get', undefined],
      ['patch', { birthYear: 1990 }],
    ] as const)('%s → 409 ONBOARDING_REQUIRED', async (method, body) => {
      const res = await api()
        [method]('/api/v1/goal')
        .set('Authorization', auth)
        .send(body)
        .expect(409);
      expect(res.body).toMatchObject({ code: 'ONBOARDING_REQUIRED' });
    });
  });

  describe('GET /goal', () => {
    it('問卷完成後：每月 4 萬、目標 1,200 萬，出生年與自估儲蓄是 null', async () => {
      await onboard();
      const res = await api()
        .get('/api/v1/goal')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toEqual({
        name: '財富自由',
        monthlySpending: '40000.00',
        targetAmount: '12000000.00',
        birthYear: null,
        estMonthlySaving: null,
      });
    });

    it('只看得到自己的目標', async () => {
      const otherId = await createUser(prisma, 'd-goal-other@example.com');
      await app
        .get(OnboardingService)
        .submit(otherId, { monthlySpending: 80000 });
      await api().get('/api/v1/goal').set('Authorization', auth).expect(409);
    });
  });

  describe('PATCH /goal', () => {
    beforeEach(onboard);

    it('改每月花費 → 目標金額重算 × 300', async () => {
      const res = await patch({ monthlySpending: 50000 }).expect(200);
      expect(res.body).toMatchObject({
        monthlySpending: '50000.00',
        targetAmount: '15000000.00',
      });
      const goal = await prisma.goal.findUniqueOrThrow({ where: { userId } });
      expect(goal.targetAmount.toFixed(2)).toBe('15000000.00');
    });

    it('只改自己的目標：別人的目標不受影響（AC-02）', async () => {
      const otherId = await createUser(prisma, 'd-goal-other@example.com');
      await app
        .get(OnboardingService)
        .submit(otherId, { monthlySpending: 80000 });

      await patch({
        monthlySpending: 50000,
        birthYear: 1990,
        estMonthlySaving: '15000',
      }).expect(200);

      const other = await prisma.goal.findUniqueOrThrow({
        where: { userId: otherId },
      });
      expect(other.monthlySpending.toFixed(2)).toBe('80000.00');
      expect(other.targetAmount.toFixed(2)).toBe('24000000.00');
      expect(other.birthYear).toBeNull();
      expect(other.estMonthlySaving).toBeNull();
    });

    it('填出生年與自估儲蓄；沒傳的欄位保持原值', async () => {
      await patch({ birthYear: 1990 }).expect(200);
      const res = await patch({ estMonthlySaving: '15000.50' }).expect(200);
      expect(res.body).toEqual({
        name: '財富自由',
        monthlySpending: '40000.00',
        targetAmount: '12000000.00',
        birthYear: 1990,
        estMonthlySaving: '15000.50',
      });
    });

    it('自估儲蓄可以是 0 或負數（入不敷出）', async () => {
      await patch({ estMonthlySaving: '0' }).expect(200);
      const res = await patch({ estMonthlySaving: '-3000' }).expect(200);
      expect(res.body).toMatchObject({ estMonthlySaving: '-3000.00' });
    });

    it('傳 null 清空出生年與自估儲蓄', async () => {
      await patch({ birthYear: 1990, estMonthlySaving: '15000' }).expect(200);
      const res = await patch({
        birthYear: null,
        estMonthlySaving: null,
      }).expect(200);
      expect(res.body).toMatchObject({
        birthYear: null,
        estMonthlySaving: null,
      });
    });

    it('空的 PATCH（{}）→ 200，回傳目前的資料', async () => {
      const res = await patch({}).expect(200);
      expect(res.body).toMatchObject({ monthlySpending: '40000.00' });
    });

    it('出生年可以是台北的今年', async () => {
      await patch({ birthYear: 2026 }).expect(200);
    });

    it('出生年晚於台北的今年 → 400 VALIDATION_FAILED（field: birthYear），不會寫入', async () => {
      const res = await patch({
        birthYear: 2027,
        monthlySpending: 50000,
      }).expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'birthYear', code: 'VALIDATION_FAILED' }],
      });
      const goal = await prisma.goal.findUniqueOrThrow({ where: { userId } });
      expect(goal.birthYear).toBeNull();
      expect(goal.monthlySpending.toFixed(2)).toBe('40000.00');
    });

    it('「今年」用台北時間：UTC 12/31 16:00 已經是台北的新年', async () => {
      clock.set('2026-12-31T16:00:00Z');
      await patch({ birthYear: 2027 }).expect(200);
    });

    it.each([
      ['monthlySpending 是 null', { monthlySpending: null }],
      ['monthlySpending 低於 1,000', { monthlySpending: 999 }],
      ['monthlySpending 不是整數', { monthlySpending: 40000.5 }],
      ['birthYear 早於 1900', { birthYear: 1899 }],
      ['不能直接改目標金額', { targetAmount: '1' }],
    ])('%s → 400 VALIDATION_FAILED', async (_, body) => {
      const res = await patch(body).expect(400);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('自估儲蓄格式不對 → 400 AMOUNT_INVALID', async () => {
      const res = await patch({ estMonthlySaving: '1e3' }).expect(400);
      expect(res.body).toMatchObject({ code: 'AMOUNT_INVALID' });
    });
  });
});
