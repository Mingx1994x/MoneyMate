import { Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { PrismaService } from '../../prisma/index.js';
import { HealthController } from './health.controller.js';

function setup(queryRaw: () => Promise<unknown>) {
  const $queryRaw = vi.fn(queryRaw);
  const controller = new HealthController({
    $queryRaw,
  } as unknown as PrismaService);
  const res = { status: vi.fn() };
  const warn = vi
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  const check = () => controller.check(res as unknown as Response);
  return { $queryRaw, res, warn, check };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('HealthController', () => {
  it('查詢成功：回 ok，不設 503', async () => {
    const { $queryRaw, res, warn, check } = setup(() =>
      Promise.resolve([{ '?column?': 1 }]),
    );
    await expect(check()).resolves.toEqual({ status: 'ok', db: 'ok' });
    expect(res.status).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  // 擋得住「把 query.catch(() => {}) 傳進 race」的寫法：那樣會拿到 undefined 而回 200
  it('查詢立刻失敗：503 與 down', async () => {
    const { $queryRaw, res, check } = setup(() =>
      Promise.reject(new Error('connect ECONNREFUSED')),
    );
    await expect(check()).resolves.toEqual({ status: 'error', db: 'down' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('查詢一直不回應：2 秒後 503，計時器已清除', async () => {
    vi.useFakeTimers();
    const { $queryRaw, res, warn, check } = setup(
      () => new Promise(() => undefined),
    );
    const pending = check();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ status: 'error', db: 'down' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(warn).toHaveBeenCalledWith('資料庫檢查逾時（2000ms）');
    expect(vi.getTimerCount()).toBe(0);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });

  it('查詢成功時計時器也會清除', async () => {
    vi.useFakeTimers();
    const { check } = setup(() => Promise.resolve([]));
    await check();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Prisma 錯誤：日誌記 kind 與 causeCode，不記 message', async () => {
    const err = Object.assign(new Error('tenant/user postgres.sentinel-xyz'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'postgres',
            code: 'XX000',
            message: 'tenant/user postgres.sentinel-xyz not found',
          },
        },
      },
    });
    const { warn, check } = setup(() => Promise.reject(err));
    await check();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('"kind":"postgres"');
    expect(logged).toContain('"causeCode":"XX000"');
    expect(logged).not.toContain('sentinel-xyz');
  });

  it('一般的 Error：只記名稱，不記 message 與 stack', async () => {
    const { warn, check } = setup(() =>
      Promise.reject(new Error('timeout sentinel-xyz')),
    );
    await check();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toBe('資料庫檢查失敗：Error');
  });
});
