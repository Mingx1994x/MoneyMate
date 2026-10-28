import {
  isSwaggerEnabled,
  parseCorsOrigins,
  validateEnv,
} from './env.validation.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app_dev',
  CORS_ORIGIN: 'http://localhost:3000',
  JWT_SECRET: 'dev-insecure-jwt-secret',
};

// production 用的金鑰：至少 32 字元、不含 insecure
const PRODUCTION_JWT_SECRET = 'q7Vb2kLx9TzR4mNw8PdY3sHc6FgJ1aUe5XoK0iBt';

describe('parseCorsOrigins', () => {
  it('去掉空白與結尾的 /，切成多個 origin', () => {
    expect(
      parseCorsOrigins('http://localhost:3000/ , https://a.vercel.app'),
    ).toEqual(['http://localhost:3000', 'https://a.vercel.app']);
  });
});

describe('validateEnv', () => {
  it('合法設定通過，並套用預設值與型別轉換', () => {
    const env = validateEnv({ ...valid, PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_POOL_MAX).toBe(5);
  });

  it('沒有 PORT 時預設 3001', () => {
    expect(validateEnv(valid).PORT).toBe(3001);
  });

  it('CORS_ORIGIN 經正規化後合法即通過', () => {
    expect(() =>
      validateEnv({
        ...valid,
        CORS_ORIGIN: 'http://localhost:3000/ , https://a.vercel.app',
      }),
    ).not.toThrow();
  });

  it.each([
    '*',
    '',
    'http://localhost:3000,',
    'https://a.vercel.app/path',
    'localhost:3000',
    // 以下格式看似合法，但永遠比對不到瀏覽器送出的 Origin
    'https://MoneyMate.vercel.app',
    'https://a.vercel.app:443',
    'http://localhost:99999',
    'http://user@localhost:3000',
    'ftp://localhost:3000',
  ])('CORS_ORIGIN=%j 驗證失敗', (origin) => {
    expect(() => validateEnv({ ...valid, CORS_ORIGIN: origin })).toThrow(
      /CORS_ORIGIN/,
    );
  });

  it.each([
    'mysql://postgres:postgres@localhost:5432/app_dev',
    'postgresql://postgres:pa#ss@localhost:5432/app_dev',
    'postgresql://',
  ])('DATABASE_URL=%j 驗證失敗', (url) => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: url })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('密碼做過 URL 編碼的 DATABASE_URL 通過', () => {
    expect(() =>
      validateEnv({
        ...valid,
        DATABASE_URL: 'postgresql://postgres:pa%23ss@localhost:5432/app_dev',
      }),
    ).not.toThrow();
  });

  it('列出所有缺少的必要變數', () => {
    expect(() => validateEnv({})).toThrow(
      /NODE_ENV[\s\S]*DATABASE_URL[\s\S]*CORS_ORIGIN/,
    );
  });

  it('錯誤訊息不含任何變數的值', () => {
    const secret = 'super-secret-password';
    let message = '';
    try {
      validateEnv({
        ...valid,
        DATABASE_URL: `mysql://user:${secret}@db.example.com/app`,
        CORS_ORIGIN: `https://${secret}.example.com/path`,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/CORS_ORIGIN/);
    expect(message).not.toContain(secret);
  });
});

describe('DATABASE_SSL、DATABASE_CA_CERT、TRUST_PROXY_HOPS', () => {
  const PEM =
    '-----BEGIN CERTIFICATE-----\nMIIDxTCCAq2gAwIBAgIUTEST\n-----END CERTIFICATE-----';
  const production = {
    ...valid,
    NODE_ENV: 'production',
    DATABASE_SSL: 'true',
    DATABASE_CA_CERT: Buffer.from(PEM).toString('base64'),
    TRUST_PROXY_HOPS: '1',
    JWT_SECRET: PRODUCTION_JWT_SECRET,
  };

  it('production 全部設好時通過，型別已轉換', () => {
    const env = validateEnv(production);
    expect(env.DATABASE_SSL).toBe(true);
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });

  it('development 都沒設：DATABASE_SSL 為 false、TRUST_PROXY_HOPS 為 0', () => {
    const env = validateEnv(valid);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.DATABASE_CA_CERT).toBeUndefined();
  });

  it('production 沒設 DATABASE_SSL、TRUST_PROXY_HOPS：錯誤列出兩個變數', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(
      /DATABASE_SSL[\s\S]*TRUST_PROXY_HOPS/,
    );
  });

  it('production＋DATABASE_SSL=true 沒設 CA：失敗', () => {
    const { DATABASE_CA_CERT: _, ...rest } = production;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_CA_CERT/);
  });

  it('production＋DATABASE_SSL=false 不需要 CA', () => {
    const { DATABASE_CA_CERT: _, ...rest } = production;
    expect(validateEnv({ ...rest, DATABASE_SSL: 'false' }).DATABASE_SSL).toBe(
      false,
    );
  });

  it('CA 接受字面 \\n 的單行 PEM', () => {
    expect(() =>
      validateEnv({
        ...production,
        DATABASE_CA_CERT: PEM.replace(/\n/g, '\\n'),
      }),
    ).not.toThrow();
  });

  it.each(['not-a-cert', ''])('CA=%j 失敗（任何環境有設就驗證）', (ca) => {
    expect(() => validateEnv({ ...valid, DATABASE_CA_CERT: ca })).toThrow(
      /DATABASE_CA_CERT/,
    );
  });

  it.each(['yes', '1', 'TRUE', ''])('DATABASE_SSL=%j 失敗', (raw) => {
    expect(() => validateEnv({ ...valid, DATABASE_SSL: raw })).toThrow(
      /DATABASE_SSL/,
    );
  });

  it.each(['-1', '11', 'abc', 'true', '1.5', ''])(
    'TRUST_PROXY_HOPS=%j 失敗',
    (raw) => {
      expect(() => validateEnv({ ...valid, TRUST_PROXY_HOPS: raw })).toThrow(
        /TRUST_PROXY_HOPS/,
      );
    },
  );

  it.each([
    ['0', 0],
    ['10', 10],
  ])('TRUST_PROXY_HOPS=%j 轉成 %s', (raw, expected) => {
    expect(
      validateEnv({ ...valid, TRUST_PROXY_HOPS: raw }).TRUST_PROXY_HOPS,
    ).toBe(expected);
  });

  it('錯誤訊息不含 CA 的內容', () => {
    let message = '';
    try {
      validateEnv({ ...production, DATABASE_CA_CERT: 'secret-ca-content' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_CA_CERT/);
    expect(message).not.toContain('secret-ca-content');
  });
});

describe('SWAGGER_ENABLED', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])(
    '%j 轉成 %s（讀原始值，不受 implicit conversion 影響）',
    (raw, expected) => {
      expect(
        validateEnv({ ...valid, SWAGGER_ENABLED: raw }).SWAGGER_ENABLED,
      ).toBe(expected);
    },
  );

  it.each(['abc', '', '1', 'TRUE'])('%j 驗證失敗', (raw) => {
    expect(() => validateEnv({ ...valid, SWAGGER_ENABLED: raw })).toThrow(
      /SWAGGER_ENABLED/,
    );
  });

  it('沒設時依 NODE_ENV：production 關、其他開；有設時照設定', () => {
    expect(isSwaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(isSwaggerEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isSwaggerEnabled({ NODE_ENV: 'test' })).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'production', SWAGGER_ENABLED: true }),
    ).toBe(true);
    expect(
      isSwaggerEnabled({ NODE_ENV: 'development', SWAGGER_ENABLED: false }),
    ).toBe(false);
  });
});

describe('JWT_SECRET', () => {
  const production = {
    ...valid,
    NODE_ENV: 'production',
    DATABASE_SSL: 'false',
    TRUST_PROXY_HOPS: '1',
  };

  it.each([undefined, '', '   '])('沒設或空白（%j）時失敗', (secret) => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: secret })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('development 可以用短的假值', () => {
    expect(validateEnv(valid).JWT_SECRET).toBe('dev-insecure-jwt-secret');
  });

  it('production 至少 32 字元而且不含 insecure 才通過', () => {
    expect(
      validateEnv({ ...production, JWT_SECRET: PRODUCTION_JWT_SECRET })
        .JWT_SECRET,
    ).toBe(PRODUCTION_JWT_SECRET);
  });

  it.each([
    ['短於 32 字元', 'short-secret'],
    [
      '含 insecure（.env.example 的假值）',
      'dev-insecure-jwt-secret-padding-to-40',
    ],
    ['大寫的 INSECURE 也擋', 'x'.repeat(32) + 'INSECURE'],
  ])('production %s 時失敗', (_, secret) => {
    expect(() => validateEnv({ ...production, JWT_SECRET: secret })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('錯誤訊息不含金鑰本身', () => {
    const secret = 'leaked-insecure-value';
    let message = '';
    try {
      validateEnv({ ...production, JWT_SECRET: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).not.toContain(secret);
  });
});
