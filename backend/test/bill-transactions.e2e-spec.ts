import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { ClockService } from '../src/clock/clock.service.js';
import { toDbDate } from '../src/common/date-only.js';
import { TransactionsService } from '../src/modules/transactions/index.js';
import { CategoryType, Prisma, PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createCategory, createUser, resetDb } from './utils/db.js';
import { FakeClock } from './utils/fake-clock.js';
import { bearer } from './utils/test-token.js';

/**
 * 給 E 的帳單用的 createBillTransaction、deleteBillTransaction（PRD 16.1、16.2、16.7、D-010）。
 * 直接呼叫 service（E 在自己的資料庫交易內呼叫），再用 API 確認結果。
 */
// 繳費日 11/05 之後的某一天；不固定的話，在 11/05 之前跑會被當成未來交易、不計入餘額
const TODAY = '2026-11-10';

describe('帳單交易 service（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let transactions: TransactionsService;
  let userId: string;
  let auth: string;
  let bankId: string;
  let housingId: string;
  let billId: string;

  const pay = (amount = '18000') =>
    prisma.$transaction((tx) =>
      transactions.createBillTransaction(tx, userId, {
        billId,
        accountId: bankId,
        categoryId: housingId,
        amount: new Prisma.Decimal(amount),
        transactionDate: '2026-11-05',
        note: '11 月房租',
      }),
    );
  const unpay = (forUser = userId) =>
    prisma.$transaction((tx) =>
      transactions.deleteBillTransaction(tx, forUser, billId),
    );
  const balance = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/accounts/${bankId}`)
      .set('Authorization', auth)
      .expect(200);
    return (res.body as { currentBalance: string }).currentBalance;
  };

  beforeAll(async () => {
    const clock = FakeClock.onTaipeiDate(TODAY);
    app = await createTestApp({
      override: (b) => b.overrideProvider(ClockService).useValue(clock),
    });
    prisma = app.get(PrismaService);
    transactions = app.get(TransactionsService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'c-bills@example.com');
    auth = await bearer(app, userId);
    bankId = (
      await prisma.account.create({
        data: {
          userId,
          name: '銀行',
          accountType: 'bank',
          openingBalance: 100000,
        },
      })
    ).id;
    housingId = await createCategory(prisma, 'housing', CategoryType.expense);
    billId = (
      await prisma.bill.create({
        data: {
          userId,
          name: '房租',
          amount: 18000,
          categoryId: housingId,
          accountId: bankId,
          dueDate: toDbDate('2026-11-05'),
          dueDay: 5,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  describe('createBillTransaction（繳費）', () => {
    it('建立一筆支出：bill_id 指向帳單，交易列表標 isBillGenerated，餘額減少', async () => {
      const { id } = await pay();

      const res = await request(app.getHttpServer())
        .get(`/api/v1/transactions/${id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({
        transactionType: 'expense',
        amount: '18000.00',
        accountId: bankId,
        categoryId: housingId,
        transactionDate: '2026-11-05',
        note: '11 月房租',
        billId,
        isBillGenerated: true,
      });
      expect(await balance()).toBe('82000.00');
    });

    it('實繳金額和預定金額不同時，用實繳金額（AC-13）', async () => {
      const { id } = await pay('17500.5');
      const row = await prisma.transaction.findUniqueOrThrow({ where: { id } });
      expect(row.amount.toFixed(2)).toBe('17500.50');
    });

    it('扣款帳戶停用：409 ACCOUNT_INACTIVE，不會建立交易（D-010）', async () => {
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      await expect(pay()).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
      expect(await prisma.transaction.count()).toBe(0);
    });

    it('同一張帳單重複建立：撞 bill_id 唯一約束，只有一筆支出（AC-11 的最後防線）', async () => {
      await pay();
      await expect(pay()).rejects.toThrow();
      expect(await prisma.transaction.count()).toBe(1);
    });

    it('在 E 的交易裡：後面的步驟失敗時，支出跟著回滾', async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await transactions.createBillTransaction(tx, userId, {
            billId,
            accountId: bankId,
            categoryId: housingId,
            amount: new Prisma.Decimal(18000),
            transactionDate: '2026-11-05',
            note: '房租',
          });
          throw new Error('模擬 E 更新帳單狀態失敗');
        }),
      ).rejects.toThrow('模擬 E 更新帳單狀態失敗');
      expect(await prisma.transaction.count()).toBe(0);
    });

    it('扣款帳戶不屬於這位使用者：程式錯誤（500），不會建立交易', async () => {
      const otherId = await createUser(prisma, 'c-other@example.com');
      await expect(
        prisma.$transaction((tx) =>
          transactions.createBillTransaction(tx, otherId, {
            billId,
            accountId: bankId,
            categoryId: housingId,
            amount: new Prisma.Decimal(1),
            transactionDate: '2026-11-05',
            note: '房租',
          }),
        ),
      ).rejects.toThrow(/扣款帳戶不存在/);
      expect(await prisma.transaction.count()).toBe(0);
    });
  });

  describe('deleteBillTransaction（取消繳費）', () => {
    it('刪除帳單產生的支出，餘額恢復', async () => {
      await pay();
      await unpay();
      expect(await prisma.transaction.count()).toBe(0);
      expect(await balance()).toBe('100000.00');
    });

    it('扣款帳戶停用：409 ACCOUNT_INACTIVE，支出還在（D-010、PRD 15.11）', async () => {
      await pay();
      await prisma.account.update({
        where: { id: bankId },
        data: { isActive: false },
      });
      await expect(unpay()).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
      expect(await prisma.transaction.count()).toBe(1);
    });

    it('找不到交易（資料不一致）：程式錯誤（500）', async () => {
      await expect(unpay()).rejects.toThrow(/找不到這張帳單產生的交易/);
    });

    it('只會刪自己的：別的使用者呼叫找不到（500），支出還在', async () => {
      await pay();
      const otherId = await createUser(prisma, 'c-other@example.com');
      await expect(unpay(otherId)).rejects.toThrow(/找不到/);
      expect(await prisma.transaction.count()).toBe(1);
    });
  });
});
