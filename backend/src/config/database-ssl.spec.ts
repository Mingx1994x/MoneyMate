import { buildSslOption, parseCaCert } from './database-ssl.js';

// 只測轉換，內容不需要是真的憑證
const PEM = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDxTCCAq2gAwIBAgIUTEST',
  'AbCdEf0123456789+/==',
  '-----END CERTIFICATE-----',
].join('\n');

describe('parseCaCert', () => {
  it('真正換行的 PEM 原樣回傳（去掉前後空白）', () => {
    expect(parseCaCert(`  ${PEM}\n`)).toBe(PEM);
  });

  it('字面 \\n 的單行 PEM 轉回換行', () => {
    expect(parseCaCert(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
  });

  it('base64 編碼的 PEM 解碼後相同', () => {
    expect(parseCaCert(Buffer.from(`${PEM}\n`).toString('base64'))).toBe(PEM);
  });

  it.each([
    'not-a-cert',
    '',
    Buffer.from('hello').toString('base64'),
    '-----BEGIN CERTIFICATE-----\nno end',
  ])('%j 回 null', (raw) => {
    expect(parseCaCert(raw)).toBeNull();
  });
});

describe('buildSslOption', () => {
  it('DATABASE_SSL=false：不加密', () => {
    expect(buildSslOption({ DATABASE_SSL: false, DATABASE_CA_CERT: PEM })).toBe(
      false,
    );
  });

  it('DATABASE_SSL=true 且有 CA：{ ca }，不關掉驗證', () => {
    const option = buildSslOption({
      DATABASE_SSL: true,
      DATABASE_CA_CERT: Buffer.from(PEM).toString('base64'),
    });
    expect(option).toEqual({ ca: PEM });
    expect(option).not.toHaveProperty('rejectUnauthorized');
  });

  it('DATABASE_SSL=true 沒有 CA：用系統 CA', () => {
    expect(buildSslOption({ DATABASE_SSL: true })).toBe(true);
  });
});
