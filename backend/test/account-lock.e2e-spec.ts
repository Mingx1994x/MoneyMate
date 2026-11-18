import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { toDbDate } from '../src/common/date-only.js';
import { PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createUser, resetDb, seedCategories } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

/**
 * 帳戶的鎖（#91 review）：停用帳戶（PATCH /accounts，FOR UPDATE）和寫交易（FOR SHARE）會排隊。
 * 對「剛好可以停用」（目前餘額 0）的帳戶，同時送「停用」和一個會讓餘額變動的寫入：
 * 只會有一邊成功，而且停用的帳戶目前餘額一定是 0（PRD 15.11）。
 *
 * 會改到帳戶餘額的寫入都測一次：
 * - 一般記帳（POST /transactions）支出、轉入
 * - 修改交易（PATCH /transactions/:id）改金額、把交易移進這個帳戶
 * - 刪除交易（DELETE /transactions/:id）
 * - 帳單繳費、取消繳費（POST /bills/:id/pay、unpay → C 的 createBillTransaction、deleteBillTransaction）
 * 同時送的請求誰先不固定，所以每種重複 20 次；兩種先後都只能有一邊成功。
 */
const TODAY = '2026-11-17';
const ROUNDS = 20;

describe('帳戶的鎖：同時停用與寫交易（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let auth: string;
  let foodId: string;
  /** 轉帳用的另一個帳戶（不會被停用） */
  let otherId: string;

  const api = () => request(app.getHttpServer());

  const account = async (name: string, openingBalance: number) =>
    (
      await prisma.account.create({
        data: { userId, name, accountType: 'bank', openingBalance },
      })
    ).id;

  const deactivate = (id: string) =>
    api()
      .patch(`/api/v1/accounts/${id}`)
      .set('Authorization', auth)
      .send({ isActive: false });

  const postTx = (body: Record<string, unknown>) =>
    api().post('/api/v1/transactions').set('Authorization', auth).send(body);

  const expense = (accountId: string) =>
    postTx({
      transactionType: 'expense',
      amount: '100',
      accountId,
      categoryId: foodId,
    });

  const bill = (accountId: string, round: number) =>
    prisma.bill.create({
      data: {
        userId,
        name: `電話費 ${round}`,
        amount: 100,
        categoryId: foodId,
        accountId,
        dueDate: toDbDate(TODAY),
        dueDay: 17,
      },
    });

  const billAction = (id: string, action: 'pay' | 'unpay') =>
    api()
      .post(`/api/v1/bills/${id}/${action}`)
      .set('Authorization', auth)
      .send({});

  /**
   * 每一種情境：setup 建出「目前餘額 0、可以停用」的帳戶，回傳要和停用同時送的寫入；
   * writeOk 是寫入成功時的狀態碼。
   */
  interface Case {
    name: string;
    writeOk: number;
    setup: (round: number) => Promise<{
      accountId: string;
      write: () => request.Test;
    }>;
  }

  const cases: Case[] = [
    {
      name: '一般記帳：支出 100',
      writeOk: 201,
      setup: async (round) => {
        const accountId = await account(`支出 ${round}`, 0);
        return { accountId, write: () => expense(accountId) };
      },
    },
    {
      name: '一般記帳：從別的帳戶轉入 100（轉入帳戶也要鎖）',
      writeOk: 201,
      setup: async (round) => {
        const accountId = await account(`轉入 ${round}`, 0);
        return {
          accountId,
          write: () =>
            postTx({
              transactionType: 'transfer',
              amount: '100',
              accountId: otherId,
              toAccountId: accountId,
            }),
        };
      },
    },
    {
      name: '修改交易：金額 100 改成 50（餘額變 50）',
      writeOk: 200,
      setup: async (round) => {
        const accountId = await account(`改金額 ${round}`, 100);
        const created = await expense(accountId).expect(201);
        const txId = (created.body as { id: string }).id;
        return {
          accountId,
          write: () =>
            api()
              .patch(`/api/v1/transactions/${txId}`)
              .set('Authorization', auth)
              .send({ amount: '50' }),
        };
      },
    },
    {
      name: '修改交易：把別的帳戶的支出移進這個帳戶（餘額變 −100）',
      writeOk: 200,
      setup: async (round) => {
        const accountId = await account(`移入 ${round}`, 0);
        const created = await expense(otherId).expect(201);
        const txId = (created.body as { id: string }).id;
        return {
          accountId,
          write: () =>
            api()
              .patch(`/api/v1/transactions/${txId}`)
              .set('Authorization', auth)
              .send({ accountId }),
        };
      },
    },
    {
      name: '刪除交易：刪掉後餘額變回 100',
      writeOk: 204,
      setup: async (round) => {
        const accountId = await account(`刪除 ${round}`, 100);
        const created = await expense(accountId).expect(201);
        const txId = (created.body as { id: string }).id;
        return {
          accountId,
          write: () =>
            api()
              .delete(`/api/v1/transactions/${txId}`)
              .set('Authorization', auth),
        };
      },
    },
    {
      name: '帳單繳費 100（createBillTransaction）',
      writeOk: 200,
      setup: async (round) => {
        const accountId = await account(`繳費 ${round}`, 0);
        const b = await bill(accountId, round);
        return { accountId, write: () => billAction(b.id, 'pay') };
      },
    },
    {
      name: '取消繳費：支出刪掉後餘額變回 100（deleteBillTransaction）',
      writeOk: 200,
      setup: async (round) => {
        const accountId = await account(`取消繳費 ${round}`, 100);
        const b = await bill(accountId, round);
        await billAction(b.id, 'pay').expect(200);
        return { accountId, write: () => billAction(b.id, 'unpay') };
      },
    },
  ];

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    foodId = (await seedCategories(prisma)).food;
    userId = await createUser(prisma, 'c-lock@example.com');
    auth = await bearer(app, userId);
    otherId = await account('轉出用', 1_000_000);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  it.each(cases)(
    '同時停用與「$name」（重複 20 次）：只有一邊成功，停用的帳戶餘額一定是 0',
    async ({ setup, writeOk }) => {
      for (let round = 1; round <= ROUNDS; round++) {
        const { accountId, write } = await setup(round);
        const [off, w] = await Promise.all([deactivate(accountId), write()]);

        const res = await api()
          .get(`/api/v1/accounts/${accountId}`)
          .set('Authorization', auth)
          .expect(200);
        const after = res.body as { isActive: boolean; currentBalance: string };
        const summary =
          `第 ${round} 輪：停用 ${off.status}、寫入 ${w.status}，` +
          `isActive=${after.isActive}、餘額 ${after.currentBalance}`;

        // 只有兩種結果：先停用 → 寫入 409；先寫入 → 停用 409（餘額不是 0 了）
        const ok =
          (off.status === 200 && w.status === 409) ||
          (off.status === 409 && w.status === writeOk);
        if (!ok) throw new Error(summary);
        // 停用的帳戶目前餘額一定是 0
        if (!after.isActive && after.currentBalance !== '0.00') {
          throw new Error(summary);
        }
      }
    },
    // 20 輪 × 2 個同時的請求，慢的電腦會超過預設的 5 秒
    120_000,
  );
});
