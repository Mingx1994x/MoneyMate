import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { toDbDate, type DateOnly } from '../src/common/date-only.js';
import { BillsService } from '../src/modules/bills/index.js';
import {
  BillStatus,
  CategoryType,
  PrismaService,
  Recurrence,
} from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';
import { createCategory, createUser, resetDb } from './utils/db.js';

const TODAY = '2026-10-28';

/**
 * BILL-9：getBillAlerts 直接連 app_test 查詢（不經 HTTP）。
 * 計算規則的邊界在 src/modules/bills/bill-alerts.spec.ts；這裡只測查詢條件：
 * 只算登入者的帳單、只算待繳，以及資料庫的金額與日期轉換。
 */
describe('getBillAlerts（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let bills: BillsService;
  let userId: string;
  let otherId: string;
  let categoryId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    bills = app.get(BillsService);
  });

  afterAll(async () => {
    await resetDb(prisma);
    await app?.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    userId = await createUser(prisma, 'bill-owner@example.com');
    otherId = await createUser(prisma, 'bill-other@example.com');
    categoryId = await createCategory(prisma, 'housing', CategoryType.expense);
  });

  async function createAccount(
    owner: string,
    isActive = true,
  ): Promise<string> {
    const account = await prisma.account.create({
      data: {
        userId: owner,
        name: isActive ? '台新' : '已停用的台新',
        accountType: 'bank',
        // 停用的帳戶餘額一定是 0（PRD 15.11）
        openingBalance: isActive ? '5000.00' : '0.00',
        isActive,
      },
      select: { id: true },
    });
    return account.id;
  }

  async function createBill(
    owner: string,
    accountId: string,
    data: { name: string; amount: string; dueDate: DateOnly; paid?: boolean },
  ): Promise<string> {
    const bill = await prisma.bill.create({
      data: {
        userId: owner,
        accountId,
        categoryId,
        name: data.name,
        amount: data.amount,
        dueDate: toDbDate(data.dueDate),
        dueDay: Number(data.dueDate.slice(8, 10)),
        recurrence: Recurrence.monthly,
        ...(data.paid
          ? {
              status: BillStatus.paid,
              paidAmount: data.amount,
              paidDate: toDbDate(data.dueDate),
            }
          : {}),
      },
      select: { id: true },
    });
    return bill.id;
  }

  it('沒有帳單時兩個清單都是空的，dueTotal 是 0', async () => {
    const a = await bills.getBillAlerts(userId, TODAY);
    expect(a).toMatchObject({
      overdue: [],
      overdueCount: 0,
      dueSoon: [],
      dueSoonCount: 0,
    });
    expect(a.dueTotal.toFixed(2)).toBe('0.00');
  });

  it('只算登入者待繳的帳單：已繳與別人的帳單不算（AC-02）', async () => {
    const accountId = await createAccount(userId);
    const otherAccountId = await createAccount(otherId);
    const rent = await createBill(userId, accountId, {
      name: '房租',
      amount: '15000.00',
      dueDate: '2026-11-01',
    });
    const phone = await createBill(userId, accountId, {
      name: '手機費',
      amount: '999.00',
      dueDate: '2026-10-25',
    });
    await createBill(userId, accountId, {
      name: '已繳的房租',
      amount: '15000.00',
      dueDate: '2026-10-01',
      paid: true,
    });
    await createBill(otherId, otherAccountId, {
      name: '別人的房租',
      amount: '20000.00',
      dueDate: '2026-11-01',
    });

    const a = await bills.getBillAlerts(userId, TODAY);

    expect(a.overdue).toEqual([
      expect.objectContaining({
        id: phone,
        name: '手機費',
        dueDate: '2026-10-25',
        accountId,
        daysUntilDue: -3,
      }),
    ]);
    expect(a.dueSoon).toEqual([
      expect.objectContaining({
        id: rent,
        name: '房租',
        dueDate: '2026-11-01',
        accountId,
        daysUntilDue: 4,
      }),
    ]);
    expect(a.dueSoon[0]?.amount.toFixed(2)).toBe('15000.00');
    expect(a.dueTotal.toFixed(2)).toBe('15000.00');
  });

  it('到期日從資料庫讀出後照日期比較：第 14 天算入、第 15 天不算（AC-25）', async () => {
    const accountId = await createAccount(userId);
    await createBill(userId, accountId, {
      name: '第 14 天',
      amount: '999.00',
      dueDate: '2026-11-11',
    });
    await createBill(userId, accountId, {
      name: '第 15 天',
      amount: '50000.00',
      dueDate: '2026-11-12',
    });

    const a = await bills.getBillAlerts(userId, TODAY);

    expect(a.dueSoon.map((b) => b.name)).toEqual(['第 14 天']);
    expect(a.dueTotal.toFixed(2)).toBe('999.00');
  });

  it('金額從資料庫讀出後加總不失真', async () => {
    const accountId = await createAccount(userId);
    for (const [name, amount] of [
      ['A', '0.10'],
      ['B', '0.20'],
      ['C', '999999999999.99'],
    ] as const) {
      await createBill(userId, accountId, {
        name,
        amount,
        dueDate: '2026-11-01',
      });
    }

    const a = await bills.getBillAlerts(userId, TODAY);

    expect(a.dueTotal.toFixed(2)).toBe('1000000000000.29');
  });

  it('查詢只限制到期日的上限：一年多前就逾期的帳單照樣列出', async () => {
    const accountId = await createAccount(userId);
    await createBill(userId, accountId, {
      name: '很久以前的水費',
      amount: '500.00',
      dueDate: '2025-01-01',
    });

    const a = await bills.getBillAlerts(userId, TODAY);

    expect(a.overdue).toEqual([
      expect.objectContaining({ name: '很久以前的水費', daysUntilDue: -665 }),
    ]);
    expect(a.dueTotal.toFixed(2)).toBe('0.00');
  });

  it('扣款帳戶已停用的待繳帳單照樣列出：帳戶停用不看帳單，繳費時才回 409（PRD 15.11、D-010）', async () => {
    const inactiveId = await createAccount(userId, false);
    const rent = await createBill(userId, inactiveId, {
      name: '房租',
      amount: '15000.00',
      dueDate: '2026-11-01',
    });

    const a = await bills.getBillAlerts(userId, TODAY);

    expect(a.dueSoon).toEqual([
      expect.objectContaining({ id: rent, accountId: inactiveId }),
    ]);
    expect(a.dueTotal.toFixed(2)).toBe('15000.00');
  });
});
