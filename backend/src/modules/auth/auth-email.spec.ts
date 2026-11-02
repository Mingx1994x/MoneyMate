import { attemptKey, normalizeEmail } from './auth-email.js';

describe('normalizeEmail', () => {
  it.each([
    ['shin@example.com', 'shin@example.com'],
    ['  Shin@Example.COM ', 'shin@example.com'],
    ['\tA.B+tag@Mail.Example.org\n', 'a.b+tag@mail.example.org'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});

describe('attemptKey', () => {
  it('一般 Email 原樣使用', () => {
    expect(attemptKey('shin@example.com')).toBe('shin@example.com');
  });

  it('超過 254 字元的輸入截斷，記憶體用量有上限', () => {
    expect(attemptKey('a'.repeat(100_000))).toHaveLength(254);
  });
});
