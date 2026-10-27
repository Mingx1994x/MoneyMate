import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService, toTaipeiDate } from '../src/clock/clock.service.js';
import { ClockTestController } from './utils/clock-test.controller.js';
import { createTestApp } from './utils/create-test-app.js';
import { FakeClock } from './utils/fake-clock.js';

// 測試用的 controller 掛在 AppModule 外面也注入得到 ClockService，順便證明 ClockModule 是全域的
describe('ClockService（e2e）', () => {
  describe('用 FakeClock 替換', () => {
    let app: INestApplication<App>;
    const clock = new FakeClock('2026-10-31T16:00:00Z');

    beforeAll(async () => {
      app = await createTestApp({
        controllers: [ClockTestController],
        override: (b) => b.overrideProvider(ClockService).useValue(clock),
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('今天是 FakeClock 的台北日期', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/__clock-test')
        .expect(200);
      expect(res.body).toEqual({ today: '2026-11-01' });
    });

    it('同一個 app 裡 set() 就能換日', async () => {
      clock.set('2026-10-31T15:59:59Z');
      const res = await request(app.getHttpServer())
        .get('/api/v1/__clock-test')
        .expect(200);
      expect(res.body).toEqual({ today: '2026-10-31' });
    });
  });

  describe('沒有替換', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
      app = await createTestApp({ controllers: [ClockTestController] });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('今天是真實的台北日期', async () => {
      // 請求前後各算一次，剛好跨過台北午夜時兩個都接受
      const before = toTaipeiDate(new Date());
      const res = await request(app.getHttpServer())
        .get('/api/v1/__clock-test')
        .expect(200);
      const after = toTaipeiDate(new Date());
      expect([before, after]).toContain((res.body as { today: string }).today);
    });
  });
});
