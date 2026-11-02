import type { ArgumentsHost, INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types.js';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter.js';
import {
  ACCOUNT_IN_USE_FKEYS,
  DB_CONSTRAINT_CODES,
} from '../src/common/errors/db-constraint-codes.js';
import {
  databaseException,
  readPrismaRequestError,
} from '../src/common/errors/database-exception.js';
import { Prisma, PrismaService } from '../src/prisma/index.js';
import { createTestApp } from './utils/create-test-app.js';

const PREFIX = 'db-errors-';
const OVERFLOW = '9999999999999.99';

function respond(exception: unknown): {
  status?: number;
  body?: Record<string, unknown>;
} {
  const captured: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

function originalCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return undefined;
  const adapter = (meta as { driverAdapterError?: unknown }).driverAdapterError;
  if (typeof adapter !== 'object' || adapter === null) return undefined;
  const cause = (adapter as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || cause === null) return undefined;
  return (cause as { originalCode?: unknown }).originalCode;
}

describe('資料庫錯誤轉換（e2e）', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  async function cleanup(): Promise<void> {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.category.deleteMany({
      where: { code: { startsWith: PREFIX } },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup().catch(() => undefined);
    await app?.close();
  });

  afterEach(async () => {
    await cleanup();
  });

  it('重複 Email 回 409，訊息是代碼表那句', async () => {
    const email = `${PREFIX}dup@test.local`;
    await prisma.user.create({ data: { email, passwordHash: 'x' } });
    let error: unknown;
    try {
      await prisma.user.create({ data: { email, passwordHash: 'x' } });
    } catch (caught) {
      error = caught;
    }
    const { status, body } = respond(error);
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'AUTH_EMAIL_TAKEN',
      message: '這個 Email 已經註冊過了',
    });
    expect(JSON.stringify(body)).not.toContain(email);
  });

  it('第二個估計帳戶回 409 ONBOARDING_ALREADY_DONE', async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}est@test.local`, passwordHash: 'x' },
    });
    await prisma.account.create({
      data: {
        userId: user.id,
        name: '估計',
        accountType: 'bank',
        isEstimate: true,
        openingBalance: new Prisma.Decimal('0.00'),
      },
    });
    let error: unknown;
    try {
      await prisma.account.create({
        data: {
          userId: user.id,
          name: '估計2',
          accountType: 'bank',
          isEstimate: true,
          openingBalance: new Prisma.Decimal('0.00'),
        },
      });
    } catch (caught) {
      error = caught;
    }
    const { status, body } = respond(error);
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'ONBOARDING_ALREADY_DONE',
      message: '已經完成問卷了',
    });
  });

  it('超過 numeric(14,2) 回 400 AMOUNT_OVERFLOW', async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}over@test.local`, passwordHash: 'x' },
    });
    let error: unknown;
    try {
      await prisma.account.create({
        data: {
          userId: user.id,
          name: '溢位',
          accountType: 'bank',
          openingBalance: new Prisma.Decimal(OVERFLOW),
        },
      });
    } catch (caught) {
      error = caught;
    }
    const { status, body } = respond(error);
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'AMOUNT_OVERFLOW',
      message: '金額超出可記錄的範圍',
    });
    expect(JSON.stringify(body)).not.toContain(OVERFLOW);
  });

  it('銀行帳戶負的初始餘額回 500，body 不含約束名稱', async () => {
    const user = await prisma.user.create({
      data: { email: `${PREFIX}check@test.local`, passwordHash: 'x' },
    });
    let error: unknown;
    try {
      await prisma.account.create({
        data: {
          userId: user.id,
          name: '負餘額',
          accountType: 'bank',
          openingBalance: new Prisma.Decimal('-1.00'),
        },
      });
    } catch (caught) {
      error = caught;
    }
    const { status, body } = respond(error);
    expect(status).toBe(500);
    expect(body?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain(
      'accounts_opening_balance_check',
    );
  });

  it('寫入別人的帳戶看得到外鍵名稱，但不轉換', async () => {
    const owner = await prisma.user.create({
      data: { email: `${PREFIX}owner@test.local`, passwordHash: 'x' },
    });
    const other = await prisma.user.create({
      data: { email: `${PREFIX}other@test.local`, passwordHash: 'x' },
    });
    const account = await prisma.account.create({
      data: {
        userId: other.id,
        name: '別人',
        accountType: 'bank',
        openingBalance: new Prisma.Decimal('1.00'),
      },
    });
    const category = await prisma.category.create({
      data: { code: `${PREFIX}food`, name: '飲食', type: 'expense' },
    });
    let error: unknown;
    try {
      await prisma.transaction.create({
        data: {
          userId: owner.id,
          accountId: account.id,
          transactionType: 'expense',
          amount: new Prisma.Decimal('1.00'),
          categoryId: category.id,
          transactionDate: new Date('2026-10-01T00:00:00.000Z'),
        },
      });
    } catch (caught) {
      error = caught;
    }
    expect(readPrismaRequestError(error)?.index).toBe(
      'transactions_account_id_user_id_fkey',
    );
    expect(databaseException(error)).toBeUndefined();
  });

  it('交易裡接住唯一鍵錯誤後再查詢，外層是 25P02', async () => {
    const email = `${PREFIX}tx@test.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: 'x' },
    });
    let error: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        try {
          await tx.user.create({ data: { email, passwordHash: 'x' } });
        } catch {
          await tx.user.findFirst({ where: { id: user.id } });
        }
      });
    } catch (caught) {
      error = caught;
    }
    expect(readPrismaRequestError(error)?.code).toBe('P2039');
    expect(originalCode(error)).toBe('25P02');
  });

  it('交易裡接住後改丟一般 Error，外層仍是那個 Error', async () => {
    const email = `${PREFIX}marker@test.local`;
    await prisma.user.create({ data: { email, passwordHash: 'x' } });
    class Marker extends Error {
      override name = 'MarkerError';
    }
    let error: unknown;
    try {
      await prisma.$transaction(async (tx) => {
        try {
          await tx.user.create({ data: { email, passwordHash: 'x' } });
        } catch {
          throw new Marker('business');
        }
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Marker);
    expect((error as Error).name).toBe('MarkerError');
    expect(readPrismaRequestError(error)).toBeUndefined();
  });

  it('對照表的名稱都在 catalog 裡，唯一索引與外鍵分屬兩邊', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
    `;
    const constraints = await prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname
      FROM pg_constraint
      JOIN pg_namespace ON pg_namespace.oid = pg_constraint.connamespace
      WHERE nspname = 'public'
    `;
    const indexNames = new Set(indexes.map((row) => row.indexname));
    const constraintNames = new Set(constraints.map((row) => row.conname));

    for (const name of Object.keys(DB_CONSTRAINT_CODES)) {
      expect(indexNames.has(name), name).toBe(true);
      expect(constraintNames.has(name), name).toBe(false);
    }
    for (const name of ACCOUNT_IN_USE_FKEYS) {
      expect(constraintNames.has(name), name).toBe(true);
      expect(indexNames.has(name), name).toBe(false);
    }
  });
});
