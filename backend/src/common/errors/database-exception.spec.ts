import { AppException } from './app.exception.js';
import {
  ACCOUNT_IN_USE_FKEYS,
  DB_CONSTRAINT_CODES,
} from './db-constraint-codes.js';
import { databaseException } from './database-exception.js';
import { ERROR_CODES } from './error-codes.js';

const EMAIL = 'secret-email@test.local';
const OVERFLOW = '9999999999999.99';

function prismaError(options: {
  code: string;
  message?: string;
  index?: string;
  fields?: string[];
  kind?: string;
  cause?: string;
  detail?: string;
  modelName?: string;
  operation?: string;
}): Error {
  const constraint =
    options.index !== undefined
      ? { index: options.index }
      : options.fields !== undefined
        ? { fields: options.fields }
        : undefined;
  const cause: Record<string, unknown> = {};
  if (options.kind !== undefined) cause.kind = options.kind;
  if (constraint !== undefined) cause.constraint = constraint;
  if (options.cause !== undefined) cause.cause = options.cause;
  if (options.detail !== undefined) cause.detail = options.detail;

  const meta: Record<string, unknown> = {};
  if (options.modelName !== undefined) meta.modelName = options.modelName;
  if (options.operation !== undefined) meta.operation = options.operation;
  if (options.code !== 'P2025') {
    meta.driverAdapterError = { cause };
  }

  return Object.assign(new Error(options.message ?? 'prisma'), {
    name: 'PrismaClientKnownRequestError',
    code: options.code,
    meta,
  });
}

describe('databaseException', () => {
  it('對照表每一列都能建成 AppException，狀態碼合法', () => {
    for (const entry of Object.values(DB_CONSTRAINT_CODES)) {
      const exception =
        'field' in entry
          ? AppException.forField(entry.code, entry.field)
          : new AppException(entry.code);
      expect(exception.getStatus()).toBe(ERROR_CODES[entry.code].status);
    }
  });

  it('帳戶複合外鍵不在對照表裡', () => {
    const keys = new Set(Object.keys(DB_CONSTRAINT_CODES));
    for (const name of ACCOUNT_IN_USE_FKEYS) {
      expect(keys.has(name)).toBe(false);
    }
  });

  it('重複 Email 轉成 AUTH_EMAIL_TAKEN，details 的訊息來自代碼表', () => {
    const exception = databaseException(
      prismaError({
        code: 'P2002',
        index: 'users_email_key',
        kind: 'UniqueConstraintViolation',
        message: EMAIL,
      }),
    );
    expect(exception).toBeInstanceOf(AppException);
    expect(exception?.code).toBe('AUTH_EMAIL_TAKEN');
    expect(exception?.opts.details).toEqual([
      {
        field: 'email',
        code: 'AUTH_EMAIL_TAKEN',
        message: '這個 Email 已經註冊過了',
      },
    ]);
    expect(exception?.getResponse()).toEqual({ code: 'AUTH_EMAIL_TAKEN' });
    expect(JSON.stringify(exception)).not.toContain(EMAIL);
  });

  it.each(['accounts_one_estimate_per_user', 'goals_user_id_key'] as const)(
    '%s 轉成 ONBOARDING_ALREADY_DONE，沒有 details',
    (index) => {
      const exception = databaseException(
        prismaError({ code: 'P2002', index, message: EMAIL }),
      );
      expect(exception?.code).toBe('ONBOARDING_ALREADY_DONE');
      expect(exception?.opts.details).toBeUndefined();
      expect(JSON.stringify(exception)).not.toContain(EMAIL);
    },
  );

  it('同一張帳單的第二筆交易轉成 BILL_ALREADY_PAID', () => {
    const exception = databaseException(
      prismaError({ code: 'P2002', index: 'transactions_bill_id_key' }),
    );
    expect(exception?.code).toBe('BILL_ALREADY_PAID');
    expect(exception?.opts.details).toBeUndefined();
  });

  it('未知索引、沒有 index、三個帳戶外鍵都不轉換', () => {
    expect(
      databaseException(
        prismaError({ code: 'P2002', index: 'not_a_real_index' }),
      ),
    ).toBeUndefined();
    expect(
      databaseException(
        prismaError({ code: 'P2002', fields: ['email'], message: EMAIL }),
      ),
    ).toBeUndefined();
    for (const index of ACCOUNT_IN_USE_FKEYS) {
      expect(
        databaseException(
          prismaError({ code: 'P2003', index, message: EMAIL }),
        ),
      ).toBeUndefined();
    }
  });

  it('P2025 是通用 NOT_FOUND，P2020 是 AMOUNT_OVERFLOW，P2039 不轉換', () => {
    const missing = databaseException(
      prismaError({ code: 'P2025', modelName: 'Loan', operation: 'update' }),
    );
    expect(missing?.code).toBe('NOT_FOUND');
    expect(missing?.opts.details).toBeUndefined();

    const overflow = databaseException(
      prismaError({
        code: 'P2020',
        kind: 'ValueOutOfRange',
        cause: OVERFLOW,
        message: OVERFLOW,
      }),
    );
    expect(overflow?.code).toBe('AMOUNT_OVERFLOW');
    expect(JSON.stringify(overflow)).not.toContain(OVERFLOW);

    expect(
      databaseException(
        prismaError({
          code: 'P2039',
          kind: 'postgres',
          detail: 'Failing row contains (secret-row).',
          message: 'violates check constraint "accounts_opening_balance_check"',
        }),
      ),
    ).toBeUndefined();
  });
});
