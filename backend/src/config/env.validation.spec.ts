import {
  isSwaggerEnabled,
  parseCorsOrigins,
  validateEnv,
} from './env.validation.js';

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/app_dev',
  CORS_ORIGIN: 'http://localhost:3000',
};

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
