import { validate } from 'class-validator';
import { AppException } from './errors/app.exception.js';
import { IS_ID, IsId, ParseIdPipe } from './id.js';

const VALID = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';

const INVALID = [
  'abc',
  '3f0c9a52-6f1e-4d0a-9a51', // 少一段
  `${VALID}-1234`, // 多一段
  ` ${VALID}`,
  `${VALID} `,
  '',
];

describe('ParseIdPipe', () => {
  const pipe = new ParseIdPipe('LOAN_NOT_FOUND');

  it('UUID（不分大小寫）原樣通過', () => {
    expect(pipe.transform(VALID)).toBe(VALID);
    expect(pipe.transform(VALID.toUpperCase())).toBe(VALID.toUpperCase());
  });

  it.each(INVALID)('%j 丟出該資源的 404', (value) => {
    let thrown: unknown;
    try {
      pipe.transform(value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppException);
    expect((thrown as AppException).code).toBe('LOAN_NOT_FOUND');
    expect((thrown as AppException).getStatus()).toBe(404);
  });
});

class Dto {
  @IsId('ACCOUNT_NOT_FOUND')
  accountId: unknown = VALID;
}

describe('@IsId', () => {
  it('UUID（不分大小寫）通過', async () => {
    expect(await validate(new Dto())).toEqual([]);
    const upper = new Dto();
    upper.accountId = VALID.toUpperCase();
    expect(await validate(upper)).toEqual([]);
  });

  it('代碼受型別限制：pipe 只收允許 404 的代碼，@IsId 只收允許 400 的代碼', () => {
    // @ts-expect-error TRANSFER_SAME_ACCOUNT 不允許 404
    const badPipe = () => new ParseIdPipe('TRANSFER_SAME_ACCOUNT');
    const badIsId = () =>
      // @ts-expect-error LOAN_NOT_FOUND 不允許 400
      IsId('LOAN_NOT_FOUND');
    // ACCOUNT_NOT_FOUND 兩邊都可以（404，alsoAllowed 400）；CATEGORY_NOT_FOUND 只有 400
    const ok = () => [
      new ParseIdPipe('ACCOUNT_NOT_FOUND'),
      IsId('ACCOUNT_NOT_FOUND'),
      IsId('CATEGORY_NOT_FOUND'),
    ];
    expect(badPipe).not.toThrow();
    expect(badIsId).not.toThrow();
    expect(ok).not.toThrow();
  });

  it.each([...INVALID, 123, null])(
    '%j 失敗，context 帶代碼給 INF-4',
    async (value) => {
      const dto = new Dto();
      dto.accountId = value;
      const [error] = await validate(dto);
      expect(Object.keys(error.constraints ?? {})).toEqual([IS_ID]);
      expect(error.contexts?.[IS_ID]).toEqual({ code: 'ACCOUNT_NOT_FOUND' });
    },
  );
});
