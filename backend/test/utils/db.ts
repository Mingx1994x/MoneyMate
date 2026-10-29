import { toDbDate, type DateOnly } from '../../src/common/date-only.js';
import {
  CategoryType,
  Prisma,
  type PrismaService,
  TransactionType,
} from '../../src/prisma/index.js';

/**
 * e2e 共用的資料庫工具（C 的整合測試基礎設施）。
 * app_test 是所有測試檔共用的（fileParallelism: false），每個檔案自己在 beforeEach 清資料，
 * 不要依賴別的測試檔留下的資料。
 */

/** 清空所有業務資料：users 會 CASCADE 到 accounts、transactions、loans、bills、goals；系統分類也一起清 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE users, categories CASCADE');
}

/** 直接在資料庫建一個使用者（不走註冊 API），回傳 id；搭配 bearer(app, id) 取得 token */
export async function createUser(
  prisma: PrismaService,
  email: string,
): Promise<string> {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'not-a-real-hash' },
    select: { id: true },
  });
  return user.id;
}

/** 建一個系統分類（userId 是 null），回傳 id。code 必須唯一 */
export async function createCategory(
  prisma: PrismaService,
  code: string,
  type: CategoryType,
): Promise<string> {
  const c = await prisma.category.create({
    data: { code, name: code, type, sortOrder: 1 },
    select: { id: true },
  });
  return c.id;
}

/** 直接在資料庫建一筆交易（不走 API），金額是字串 */
export async function createTransaction(
  prisma: PrismaService,
  data: {
    userId: string;
    accountId: string;
    transactionType: TransactionType;
    amount: string;
    transactionDate: DateOnly;
    categoryId?: string;
    toAccountId?: string;
  },
): Promise<void> {
  await prisma.transaction.create({
    data: {
      userId: data.userId,
      accountId: data.accountId,
      transactionType: data.transactionType,
      amount: new Prisma.Decimal(data.amount),
      transactionDate: toDbDate(data.transactionDate),
      categoryId: data.categoryId ?? null,
      toAccountId: data.toAccountId ?? null,
    },
  });
}
