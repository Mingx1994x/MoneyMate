import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  NotImplementedException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AllExceptionsFilter,
  describeError,
  isDatabaseError,
} from './all-exceptions.filter.js';
import { AppException } from './app.exception.js';
import { detail } from './error-codes.js';

interface Captured {
  status?: number;
  body?: Record<string, unknown>;
}

function run(exception: unknown, req: object = {}): Captured {
  const captured: Captured = {};
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
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return captured;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('AllExceptionsFilter', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AppException：代碼表的狀態碼與訊息，details 照帶', () => {
    const { status, body } = run(
      new AppException('ACCOUNT_NOT_FOUND', {
        status: 400,
        details: [detail('accountId', 'ACCOUNT_NOT_FOUND')],
      }),
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'ACCOUNT_NOT_FOUND',
      message: '找不到這個帳戶',
      details: [
        {
          field: 'accountId',
          code: 'ACCOUNT_NOT_FOUND',
          message: '找不到這個帳戶',
        },
      ],
    });
    expect(body?.requestId).toMatch(UUID);
    expect(body).not.toHaveProperty('retryAfterSeconds');
  });

  it('429 才輸出 retryAfterSeconds', () => {
    expect(
      run(new AppException('TOO_MANY_REQUESTS', { retryAfterSeconds: 60 }))
        .body,
    ).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      retryAfterSeconds: 60,
    });
    expect(
      run(new AppException('LOAN_NOT_FOUND', { retryAfterSeconds: 60 })).body,
    ).not.toHaveProperty('retryAfterSeconds');
  });

  it.each([
    [new BadRequestException(), 400, 'BAD_REQUEST'],
    [new UnauthorizedException(), 401, 'AUTH_UNAUTHENTICATED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new ConflictException(), 409, 'CONFLICT'],
    [new HttpException('x', 429), 429, 'TOO_MANY_REQUESTS'],
    [new NotImplementedException(), 501, 'NOT_IMPLEMENTED'],
  ])('其他 HttpException 走備援表：%s → %i %s', (exception, status, code) => {
    const { body } = run(exception);
    expect(body).toMatchObject({ statusCode: status, code, details: [] });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('HttpException 的 body 帶 code 也不讀，訊息不用 Nest 的英文', () => {
    const { body } = run(new BadRequestException({ code: 'LOAN_NOT_FOUND' }));
    expect(body).toMatchObject({
      code: 'BAD_REQUEST',
      message: '請求格式不正確',
    });
  });

  it('http-errors 類錯誤（status＋expose）依狀態碼轉換，不記日誌', () => {
    const err = Object.assign(new Error('unsupported charset "LATIN1"'), {
      status: 415,
      expose: true,
    });
    expect(run(err).body).toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('expose 不是 true 的錯誤當成未預期的例外', () => {
    const err = Object.assign(new Error('x'), { status: 400 });
    expect(run(err).status).toBe(500);
  });

  it('備援表以外的 4xx 回 500 並記 warn', () => {
    const { body } = run(new HttpException('teapot', 418));
    expect(body).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('5xx 的 HttpException 記 error，內容含 stack 才查得到原因', () => {
    const { body } = run(
      new InternalServerErrorException('x', { cause: new Error('root') }),
    );
    expect(body).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('InternalServerErrorException'),
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('AppException 的 5xx 記 error；501 不記', () => {
    run(new AppException('INTERNAL_ERROR'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    run(new AppException('NOT_IMPLEMENTED'));
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('details 的訊息重新取自代碼表；retryAfterSeconds 至少 1 的整數', () => {
    const { body } = run(
      new AppException('TOO_MANY_REQUESTS', {
        details: [
          {
            field: 'email',
            code: 'AUTH_INVALID_CREDENTIALS',
            message: '手寫的',
          },
        ],
        retryAfterSeconds: 0.2,
      }),
    );
    expect(body?.details).toEqual([
      {
        field: 'email',
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Email 或密碼錯誤',
      },
    ]);
    expect(body?.retryAfterSeconds).toBe(1);
    expect(
      run(new AppException('TOO_MANY_REQUESTS', { retryAfterSeconds: 59.1 }))
        .body?.retryAfterSeconds,
    ).toBe(60);
  });

  it('一般 Error 回 500，body 不含 message，日誌記 stack', () => {
    const { status, body } = run(new Error('secret-123'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret-123');
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: '系統發生錯誤，請稍後再試',
      details: [],
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('有 req.id 時沿用（INF-5 之後）', () => {
    expect(
      run(new NotFoundException(), { id: 'abc-123' }).body?.requestId,
    ).toBe('abc-123');
  });

  it('headersSent 時記 error 並結束連線，不改狀態碼', () => {
    const res = {
      headersSent: true,
      status: vi.fn(),
      json: vi.fn(),
      end: vi.fn(),
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
    } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(new Error('x'), host);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('describeError（500 的日誌內容）', () => {
  it('Prisma 的錯誤只記名稱、代碼與約束名稱，不含 message', () => {
    const err = Object.assign(
      new Error('Invalid `prisma.user.create()` email=a@b.c'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: {
          modelName: 'User',
          driverAdapterError: {
            cause: {
              kind: 'UniqueConstraintViolation',
              constraint: { index: 'users_email_key' },
            },
          },
        },
      },
    );
    const text = describeError(err);
    expect(JSON.parse(text)).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
      modelName: 'User',
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
    });
    expect(text).not.toContain('a@b.c');
  });

  it('CHECK 違反從 message 取出約束名稱，不記 detail', () => {
    const err = Object.assign(new Error('x'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'postgres',
            message:
              'new row for relation "bills" violates check constraint "bills_paid_check"',
            detail: 'Failing row contains (secret-row).',
          },
        },
      },
    });
    const text = describeError(err);
    expect(JSON.parse(text)).toMatchObject({ constraint: 'bills_paid_check' });
    expect(text).not.toContain('secret-row');
  });

  it('PrismaClientValidationError 不記 message（含完整查詢參數）', () => {
    const err = Object.assign(new Error('Argument password: secret-pw'), {
      name: 'PrismaClientValidationError',
    });
    expect(describeError(err)).not.toContain('secret-pw');
  });

  it('DriverAdapterError 只記 cause.kind 與 cause.constraint', () => {
    const err = Object.assign(new Error('x'), {
      name: 'DriverAdapterError',
      cause: {
        kind: 'ForeignKeyConstraintViolation',
        constraint: { index: 'transactions_account_id_user_id_fkey' },
        originalMessage: 'secret-original',
      },
    });
    const text = describeError(err);
    expect(JSON.parse(text)).toEqual({
      name: 'DriverAdapterError',
      kind: 'ForeignKeyConstraintViolation',
      constraint: { index: 'transactions_account_id_user_id_fkey' },
    });
    expect(text).not.toContain('secret-original');
  });

  it('連線失敗（P2010）記 kind 與 causeCode，不記 message 裡的使用者名稱', () => {
    const err = Object.assign(new Error('x'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            kind: 'postgres',
            code: 'XX000',
            message: 'tenant/user postgres.secret-tenant not found',
          },
        },
      },
    });
    const text = describeError(err);
    expect(JSON.parse(text)).toEqual({
      name: 'PrismaClientKnownRequestError',
      code: 'P2010',
      kind: 'postgres',
      causeCode: 'XX000',
    });
    expect(text).not.toContain('secret-tenant');
  });
});

describe('isDatabaseError', () => {
  it('Prisma 與 DriverAdapterError 是，一般的 Error 不是', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(isDatabaseError(named('PrismaClientKnownRequestError'))).toBe(true);
    expect(isDatabaseError(named('DriverAdapterError'))).toBe(true);
    expect(isDatabaseError(new Error('x'))).toBe(false);
    expect(isDatabaseError('x')).toBe(false);
  });
});

describe('describeError（Decimal 的錯誤）', () => {
  it('[DecimalError] 的 message 帶有輸入值，只記名稱', () => {
    const err = new Error('[DecimalError] Invalid argument: secret-abc');
    expect(describeError(err)).toBe('Error');
  });
});

const EMAIL = 'secret-email@test.local';
const OVERFLOW = '9999999999999.99';

function prismaError(options: {
  code: string;
  message?: string;
  index?: string;
  kind?: string;
  cause?: string;
  detail?: string;
}): Error {
  const cause: Record<string, unknown> = {};
  if (options.kind !== undefined) cause.kind = options.kind;
  if (options.index !== undefined) cause.constraint = { index: options.index };
  if (options.cause !== undefined) cause.cause = options.cause;
  if (options.detail !== undefined) cause.detail = options.detail;
  const meta =
    options.code === 'P2025'
      ? { modelName: 'Loan', operation: 'update' }
      : { driverAdapterError: { cause } };
  return Object.assign(new Error(options.message ?? 'prisma'), {
    name: 'PrismaClientKnownRequestError',
    code: options.code,
    meta,
  });
}

describe('資料庫錯誤轉換', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('重複 Email 回 409 AUTH_EMAIL_TAKEN，不記日誌', () => {
    const { status, body } = run(
      prismaError({
        code: 'P2002',
        index: 'users_email_key',
        message: EMAIL,
      }),
    );
    expect(status).toBe(409);
    expect(body).toMatchObject({
      statusCode: 409,
      code: 'AUTH_EMAIL_TAKEN',
      message: '這個 Email 已經註冊過了',
      details: [
        {
          field: 'email',
          code: 'AUTH_EMAIL_TAKEN',
          message: '這個 Email 已經註冊過了',
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(EMAIL);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('未知索引與帳戶外鍵回 500，body 不含索引名稱', () => {
    const unknown = run(
      prismaError({ code: 'P2002', index: 'not_a_real_index', message: EMAIL }),
    );
    expect(unknown.status).toBe(500);
    expect(unknown.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(unknown.body)).not.toContain('not_a_real_index');
    expect(errorSpy).toHaveBeenCalledTimes(1);

    const fk = run(
      prismaError({
        code: 'P2003',
        index: 'transactions_account_id_user_id_fkey',
        message: EMAIL,
      }),
    );
    expect(fk.status).toBe(500);
    expect(fk.body?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(fk.body)).not.toContain(
      'transactions_account_id_user_id_fkey',
    );
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('P2025 回 404 NOT_FOUND，不記日誌', () => {
    const { status, body } = run(
      prismaError({ code: 'P2025', message: EMAIL }),
    );
    expect(status).toBe(404);
    expect(body).toMatchObject({
      code: 'NOT_FOUND',
      message: '找不到要求的資源',
      details: [],
    });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('CHECK 違反回 500，body 不含 detail 裡的哨兵', () => {
    const { status, body } = run(
      prismaError({
        code: 'P2039',
        kind: 'postgres',
        detail: 'Failing row contains (secret-row).',
        message: 'violates check constraint "accounts_opening_balance_check"',
      }),
    );
    expect(status).toBe(500);
    expect(body?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret-row');
    expect(JSON.stringify(body)).not.toContain(
      'accounts_opening_balance_check',
    );
  });

  it('P2020 回 400 AMOUNT_OVERFLOW，記 warn 且不含哨兵', () => {
    const { status, body } = run(
      prismaError({
        code: 'P2020',
        kind: 'ValueOutOfRange',
        cause: OVERFLOW,
        message: OVERFLOW,
      }),
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: 'AMOUNT_OVERFLOW',
      message: '金額超出可記錄的範圍',
      details: [],
    });
    expect(JSON.stringify(body)).not.toContain(OVERFLOW);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('AMOUNT_OVERFLOW'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.not.stringContaining(OVERFLOW));
  });
});
