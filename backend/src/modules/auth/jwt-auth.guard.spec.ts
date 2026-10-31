import { JwtService } from '@nestjs/jwt';
import { extractBearerToken } from './jwt-auth.guard.js';
import { TokenService } from './token.service.js';

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc.def.ghi', 'abc.def.ghi'],
    ['BEARER  abc.def.ghi', 'abc.def.ghi'],
  ])('%j → %j', (header, token) => {
    expect(extractBearerToken(header)).toBe(token);
  });

  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic dXNlcjpwYXNz',
    'abc.def.ghi',
    'Bearer abc def',
  ])('%j → null', (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});

describe('TokenService', () => {
  const SECRET = 'unit-insecure-jwt-secret';
  const tokens = new TokenService(
    new JwtService({
      secret: SECRET,
      signOptions: { algorithm: 'HS256', expiresIn: 60 },
    }),
  );
  const USER_ID = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';

  it('簽出來的 token 驗證後拿回同一個使用者', async () => {
    const token = await tokens.signAccessToken({ id: USER_ID });
    await expect(tokens.verifyAccessToken(token)).resolves.toEqual({
      id: USER_ID,
    });
  });

  it('token 只帶 sub、iat、exp，有效 24 小時由 AuthModule 設定', async () => {
    const token = await tokens.signAccessToken({ id: USER_ID });
    const payload = new JwtService().decode<Record<string, unknown>>(token);
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('別的金鑰簽的 token 回 null', async () => {
    const other = await new JwtService({ secret: 'other-insecure' }).signAsync({
      sub: USER_ID,
    });
    await expect(tokens.verifyAccessToken(other)).resolves.toBeNull();
  });

  it('過期的 token 回 null', async () => {
    const expired = await new JwtService({ secret: SECRET }).signAsync({
      sub: USER_ID,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    await expect(tokens.verifyAccessToken(expired)).resolves.toBeNull();
  });

  it('alg: none（沒有簽章）的 token 回 null', async () => {
    const encode = (o: object): string =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: USER_ID })}.`;
    await expect(tokens.verifyAccessToken(unsigned)).resolves.toBeNull();
  });

  it.each([{}, { sub: '' }, { sub: 123 }])(
    '沒有合法的 sub（%j）回 null',
    async (payload) => {
      const token = await new JwtService({ secret: SECRET }).signAsync(payload);
      await expect(tokens.verifyAccessToken(token)).resolves.toBeNull();
    },
  );

  it('亂碼回 null，不丟例外', async () => {
    await expect(tokens.verifyAccessToken('not-a-jwt')).resolves.toBeNull();
  });
});
