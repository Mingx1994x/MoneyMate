import { HttpException } from '@nestjs/common';
import { AppException, isAppException } from './app.exception.js';
import type { ErrorCode } from './error-codes.js';

// 函式參數不會被收窄；寫成 `const c: ErrorCode = 'X'` 會被收窄成字面值，型別檢查就先擋下，測不到執行期檢查
const make = (code: ErrorCode, status: number) =>
  new AppException(code, { status } as { status: 400 });

describe('AppException', () => {
  it('預設狀態碼取自代碼表', () => {
    const e = new AppException('LOAN_NOT_FOUND');
    expect(e.getStatus()).toBe(404);
    expect(e.getResponse()).toEqual({ code: 'LOAN_NOT_FOUND' });
    expect(e).toBeInstanceOf(HttpException);
    expect(isAppException(e)).toBe(true);
  });

  it('alsoAllowed 的狀態碼可以指定', () => {
    expect(
      new AppException('ACCOUNT_NOT_FOUND', { status: 400 }).getStatus(),
    ).toBe(400);
    expect(
      new AppException('ACCOUNT_NOT_FOUND', { status: 404 }).getStatus(),
    ).toBe(404);
  });

  it('型別擋下不允許的狀態碼（執行期也會丟錯）', () => {
    // 每個 @ts-expect-error 都緊貼在出錯的那一行上面，Prettier 重排也不會分開
    const loan = () =>
      // @ts-expect-error LOAN_NOT_FOUND 只允許 404
      new AppException('LOAN_NOT_FOUND', { status: 400 });
    const account = () =>
      // @ts-expect-error ACCOUNT_NOT_FOUND 只允許 404、400
      new AppException('ACCOUNT_NOT_FOUND', { status: 409 });
    const field = () =>
      // @ts-expect-error forField 一樣受限
      AppException.forField('TRANSFER_SAME_ACCOUNT', 'x', 404);
    expect(loan).toThrow();
    expect(account).toThrow();
    expect(field).toThrow();
  });

  it('code 是 ErrorCode 時型別擋不住，執行期丟一般 Error（變成 500）', () => {
    let thrown: unknown;
    try {
      make('LOAN_NOT_FOUND', 400);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(HttpException);
    expect(() => make('ACCOUNT_NOT_FOUND', 409)).toThrow(
      'AppException: status not allowed for this code',
    );
    expect(make('ACCOUNT_NOT_FOUND', 400).getStatus()).toBe(400);
  });

  it('forField：頂層 code 與 details[0].code 相同，訊息取自代碼表', () => {
    const e = AppException.forField('ACCOUNT_NOT_FOUND', 'accountId', 400);
    expect(e.getStatus()).toBe(400);
    expect(e.opts.details).toEqual([
      {
        field: 'accountId',
        code: 'ACCOUNT_NOT_FOUND',
        message: '找不到這個帳戶',
      },
    ]);
    expect(
      AppException.forField('TRANSFER_SAME_ACCOUNT', 'toAccountId').getStatus(),
    ).toBe(400);
  });

  it('isAppException 不把一般 HttpException 當成 AppException', () => {
    expect(isAppException(new HttpException('x', 400))).toBe(false);
    expect(isAppException(new Error('x'))).toBe(false);
  });
});
