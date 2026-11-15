import type { ValidationError } from '@nestjs/common';
import { isAppException } from './errors/app.exception.js';
import { IS_ID } from './id.js';
import {
  IS_MONEY,
  IS_NAME,
  MONEY_NON_NEGATIVE,
  MONEY_POSITIVE,
} from './validators.js';
import { toValidationDetails, toValidationException } from './validation.js';

/** 依序列出 constraint 名稱，鍵順序就是傳入的順序 */
function err(
  property: string,
  constraintNames: string[],
  extra: Partial<ValidationError> = {},
): ValidationError {
  return {
    property,
    constraints: Object.fromEntries(constraintNames.map((n) => [n, 'msg'])),
    children: [],
    ...extra,
  };
}

function codeOf(e: ValidationError): string {
  return toValidationDetails([e])[0].code;
}

describe('toValidationDetails', () => {
  it.each([
    [['max', 'min', 'isInt'], 'VALIDATION_FAILED'],
    [[IS_MONEY, MONEY_POSITIVE], 'AMOUNT_INVALID'],
    [[MONEY_POSITIVE], 'AMOUNT_NOT_POSITIVE'],
    [[MONEY_NON_NEGATIVE], 'AMOUNT_NEGATIVE'],
    [[IS_NAME], 'NAME_INVALID'],
    [['whitelistValidation'], 'VALIDATION_FAILED'],
  ])('%j → %s', (names, code) => {
    expect(codeOf(err('f', names))).toBe(code);
  });

  // 「取第一個鍵」的錯誤實作在這些案例會失敗
  it.each([
    [[MONEY_POSITIVE, IS_MONEY], 'AMOUNT_INVALID'],
    [[IS_NAME, IS_MONEY], 'AMOUNT_INVALID'],
    [['isInt', MONEY_NON_NEGATIVE], 'AMOUNT_NEGATIVE'],
  ])('依優先順序，不依鍵順序：%j → %s', (names, code) => {
    expect(codeOf(err('f', names))).toBe(code);
  });

  it.each(['ACCOUNT_NOT_FOUND', 'CATEGORY_NOT_FOUND'])(
    'isId 的代碼取自 context：%s',
    (code) => {
      const e = err('accountId', [IS_MONEY, IS_ID], {
        contexts: { [IS_ID]: { code } },
      });
      expect(toValidationDetails([e])).toEqual([
        expect.objectContaining({ field: 'accountId', code }),
      ]);
    },
  );

  it.each([
    ['不允許 400 的代碼', { [IS_ID]: { code: 'LOAN_NOT_FOUND' } }],
    ['不是代碼的字串', { [IS_ID]: { code: 'toString' } }],
    ['context 沒有 code', { [IS_ID]: {} }],
    ['沒有 context', undefined],
  ])('isId 的 context 是%s時丟錯', (_label, contexts) => {
    const e = err('accountId', [IS_ID], { contexts });
    expect(() => toValidationDetails([e])).toThrow(Error);
  });

  it('巢狀：路徑用 . 接起來，中間層沒有 constraints 時不產生 details', () => {
    const tree: ValidationError = {
      property: 'items',
      children: [
        {
          property: '1',
          children: [
            err('amount', [MONEY_POSITIVE]),
            err('extra', ['whitelistValidation']),
          ],
        },
      ],
    };
    expect(toValidationDetails([tree]).map((d) => [d.field, d.code])).toEqual([
      ['items.1.amount', 'AMOUNT_NOT_POSITIVE'],
      ['items.1.extra', 'VALIDATION_FAILED'],
    ]);
  });

  it('同一個節點同時有 constraints 與 children 時兩者都產生', () => {
    const tree = err('items', ['arrayMaxSize'], {
      children: [{ property: '1', children: [err('amount', [IS_MONEY])] }],
    });
    expect(toValidationDetails([tree]).map((d) => d.field)).toEqual([
      'items',
      'items.1.amount',
    ]);
  });

  it('message 取自代碼表，不用驗證器的 defaultMessage', () => {
    expect(toValidationDetails([err('amount', [IS_MONEY])])).toEqual([
      { field: 'amount', code: 'AMOUNT_INVALID', message: '金額格式不正確' },
    ]);
  });
});

describe('toValidationException', () => {
  it('400，頂層代碼等於 details[0].code', () => {
    const ex = toValidationException([
      err('name', [IS_NAME]),
      err('amount', [IS_MONEY]),
    ]);
    expect(isAppException(ex)).toBe(true);
    expect(ex.getStatus()).toBe(400);
    expect(ex.code).toBe('NAME_INVALID');
    expect(ex.opts.details?.map((d) => d.code)).toEqual([
      'NAME_INVALID',
      'AMOUNT_INVALID',
    ]);
  });

  it('isId 的 400 代碼（預設 404 的 ACCOUNT_NOT_FOUND）狀態仍是 400', () => {
    const ex = toValidationException([
      err('accountId', [IS_ID], {
        contexts: { [IS_ID]: { code: 'ACCOUNT_NOT_FOUND' } },
      }),
    ]);
    expect(ex.getStatus()).toBe(400);
    expect(ex.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('details 最多 20 筆', () => {
    const errors = Array.from({ length: 25 }, (_, i) =>
      err(`k${i}`, ['whitelistValidation']),
    );
    expect(toValidationException(errors).opts.details).toHaveLength(20);
  });

  it('沒有任何 details 時是 BAD_REQUEST', () => {
    const ex = toValidationException([]);
    expect(ex.code).toBe('BAD_REQUEST');
    expect(ex.getStatus()).toBe(400);
  });
});
