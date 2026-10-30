import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto.js';
import { RegisterDto } from './register.dto.js';

// 直接用 plainToInstance 加 validate() 驗 DTO（transform 也會套用）；請求中由全域 ValidationPipe 做同樣的事
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

const valid = {
  email: 'shin@example.com',
  password: 'correct-horse',
  displayName: 'Shin',
};

describe('RegisterDto', () => {
  it('合法範例通過；不帶 displayName 或傳 null 也通過', async () => {
    expect(await invalidFields(RegisterDto, valid)).toEqual([]);
    const { displayName: _d, ...required } = valid;
    expect(await invalidFields(RegisterDto, required)).toEqual([]);
    expect(
      await invalidFields(RegisterDto, { ...valid, displayName: null }),
    ).toEqual([]);
  });

  it('Email 前後空白會被去掉；大寫在這裡不擋（service 轉小寫）', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...valid,
      email: '  Shin@Example.com ',
    });
    expect(dto.email).toBe('Shin@Example.com');
    expect(await validate(dto)).toEqual([]);
  });

  it.each(['', 'not-an-email', 'a@b', `${'a'.repeat(250)}@example.com`])(
    'Email %j 失敗',
    async (email) => {
      expect(await invalidFields(RegisterDto, { ...valid, email })).toEqual([
        'email',
      ]);
    },
  );

  it('密碼 8 字元與 72 字元都通過', async () => {
    for (const password of ['12345678', 'a'.repeat(72)]) {
      expect(await invalidFields(RegisterDto, { ...valid, password })).toEqual(
        [],
      );
    }
  });

  it.each([
    ['7 字元', '1234567'],
    ['73 字元', 'a'.repeat(73)],
    ['25 個中文字（75 bytes，超過 bcrypt 的 72 bytes）', '密'.repeat(25)],
    ['不是字串', 12345678],
  ])('密碼 %s 失敗', async (_, password) => {
    expect(await invalidFields(RegisterDto, { ...valid, password })).toEqual([
      'password',
    ]);
  });

  it('displayName 空白字串轉成 null；超過 30 字失敗', async () => {
    const dto = plainToInstance(RegisterDto, { ...valid, displayName: '   ' });
    expect(dto.displayName).toBeNull();
    expect(
      await invalidFields(RegisterDto, {
        ...valid,
        displayName: 'a'.repeat(31),
      }),
    ).toEqual(['displayName']);
  });
});

describe('LoginDto', () => {
  it('只要有填就通過（格式不對的 Email 交給 service 回 AUTH_INVALID_CREDENTIALS）', async () => {
    expect(
      await invalidFields(LoginDto, { email: 'not-an-email', password: 'x' }),
    ).toEqual([]);
  });

  it('沒填或空字串失敗', async () => {
    expect(await invalidFields(LoginDto, {})).toEqual(['email', 'password']);
    expect(
      await invalidFields(LoginDto, { email: '  ', password: '' }),
    ).toEqual(['email', 'password']);
  });
});
