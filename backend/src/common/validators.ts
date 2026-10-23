import { ValidateBy, type ValidationOptions } from 'class-validator';
import { isDateOnly } from './date-only.js';
import { isMoneyString, toMoney } from './money.js';

/**
 * constraint 名稱：INF-4 依名稱對應錯誤代碼（例如 isMoney → AMOUNT_INVALID、
 * moneyPositive → AMOUNT_NOT_POSITIVE），各 DTO 不必改。
 */
export const IS_MONEY = 'isMoney';
export const MONEY_POSITIVE = 'moneyPositive';
export const MONEY_NON_NEGATIVE = 'moneyNonNegative';
export const IS_DATE_ONLY = 'isDateOnly';

/**
 * - `positive`：> 0（一般金額）
 * - `nonNegative`：≥ 0（例如 outstandingBalance）
 * - `any`：可為負（例如 openingBalance，正負由 service 依帳戶類型檢查）
 */
export type MoneySign = 'positive' | 'nonNegative' | 'any';

/**
 * 金額欄位：字串、符合 MONEY_PATTERN，再依 sign 檢查正負。
 * sign 必填，不給預設值：漏寫正負檢查時，負的支出會反向加到餘額。
 * 格式錯時只報 isMoney，不再報正負錯誤。錯誤訊息是固定句子，不可用 $value。
 */
export function IsMoney(
  options: { sign: MoneySign },
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  const decorators = [
    ValidateBy(
      {
        name: IS_MONEY,
        validator: {
          validate: (v) => isMoneyString(v),
          defaultMessage: () =>
            '金額必須是數字字串，整數最多 12 位、小數最多 2 位',
        },
      },
      validationOptions,
    ),
  ];
  if (options.sign === 'positive') {
    decorators.push(
      ValidateBy(
        {
          name: MONEY_POSITIVE,
          validator: {
            validate: (v) => !isMoneyString(v) || toMoney(v).gt(0),
            defaultMessage: () => '金額必須大於 0',
          },
        },
        validationOptions,
      ),
    );
  }
  if (options.sign === 'nonNegative') {
    decorators.push(
      ValidateBy(
        {
          name: MONEY_NON_NEGATIVE,
          validator: {
            validate: (v) => !isMoneyString(v) || toMoney(v).gte(0),
            defaultMessage: () => '金額不可為負數',
          },
        },
        validationOptions,
      ),
    );
  }
  return (target, propertyKey) => {
    for (const decorator of decorators) decorator(target, propertyKey);
  };
}

/** 日期欄位：`YYYY-MM-DD`、真的存在的日期、年份 1900–2999（@Matches 擋不住 2/30）。 */
export function IsDateOnly(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_DATE_ONLY,
      validator: {
        validate: (v) => isDateOnly(v),
        defaultMessage: () => '日期必須是有效的 YYYY-MM-DD',
      },
    },
    validationOptions,
  );
}
