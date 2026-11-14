import { Transform } from 'class-transformer';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { parseBooleanString } from './boolean-string.js';
import { isDateOnly, isMonthString } from './date-only.js';
import { isMoneyString, toMoney } from './money.js';

/**
 * constraint 名稱：全域 ValidationPipe（common/validation.ts）依名稱對應錯誤代碼（例如 isMoney → AMOUNT_INVALID、
 * moneyPositive → AMOUNT_NOT_POSITIVE），各 DTO 不必改。
 */
export const IS_MONEY = 'isMoney';
export const MONEY_POSITIVE = 'moneyPositive';
export const MONEY_NON_NEGATIVE = 'moneyNonNegative';
export const IS_DATE_ONLY = 'isDateOnly';
export const IS_MONTH = 'isMonth';
export const IS_NAME = 'isName';
export const IS_NOTE = 'isNote';
export const IS_RATE = 'isRate';
export const IS_BOOLEAN_QUERY = 'isBooleanQuery';

const NAME_MAX_LENGTH = 30;
const NOTE_MAX_LENGTH = 200;

// 以 code point 計算長度：.length 會把一個 emoji 算成 2。
// 刻意不用 Intl.Segmenter（字素）：國旗、膚色這類組合 emoji 會算成多個字，名稱 30 字的上限因此比較保守，可以接受
function charCount(s: string): number {
  return Array.from(s).length;
}

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

/** 月份參數（例如 `?month=2026-10`）：`YYYY-MM`、月份 01–12（@Matches 擋不住 2026-13）。 */
export function IsMonth(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_MONTH,
      validator: {
        validate: (v) => isMonthString(v),
        defaultMessage: () => '月份必須是有效的 YYYY-MM',
      },
    },
    validationOptions,
  );
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

/** 名稱（帳戶、貸款、帳單）：字串、去除前後空白後 1–30 字；對應到 NAME_INVALID。只檢查不轉換，去空白用 @Trim()。 */
export function IsName(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_NAME,
      validator: {
        validate: (v) => {
          if (typeof v !== 'string') return false;
          const count = charCount(v.trim());
          return count >= 1 && count <= NAME_MAX_LENGTH;
        },
        defaultMessage: () => '名稱需為 1 到 30 個字',
      },
    },
    validationOptions,
  );
}

/** 備註：字串、最多 200 字。可為 null 的欄位另外加 @IsOptional()；空字串轉 null 用 @EmptyToNull()。 */
export function IsNote(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_NOTE,
      validator: {
        validate: (v) =>
          typeof v === 'string' && charCount(v) <= NOTE_MAX_LENGTH,
        defaultMessage: () => '備註最多 200 字',
      },
    },
    validationOptions,
  );
}

/**
 * 利率（年利率 %）：有限數字、0–100、最多 3 位小數。
 * 不用 @IsNumber({ maxDecimalPlaces })：1e-7 這類值的 toString() 沒有小數點，
 * class-validator 0.15.1 會丟 TypeError 變成 500。
 */
const RATE_STRING = /^\d+(\.\d{1,3})?$/;

export function IsRate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_RATE,
      validator: {
        // 1e-7 的 String() 是 '1e-7'，不符合 RATE_STRING，所以也會被擋下
        validate: (v) =>
          typeof v === 'number' &&
          Number.isFinite(v) &&
          v >= 0 &&
          v <= 100 &&
          RATE_STRING.test(String(v)),
        defaultMessage: () => '利率必須是 0 到 100 的數字，最多 3 位小數',
      },
    },
    validationOptions,
  );
}

function rawValue(obj: unknown, key: string): unknown {
  return (obj as Record<string, unknown>)[key];
}

/**
 * 布林 query（例如 includeInactive）：只接受 'true'／'false'。
 * 不用 @Type(() => Boolean)：'false' 會變成 true。transform 由全域 ValidationPipe 的 transform: true 套用。
 */
export function IsBooleanQuery(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  const transform = Transform(({ obj, key }) =>
    parseBooleanString(rawValue(obj, key)),
  );
  const validate = ValidateBy(
    {
      name: IS_BOOLEAN_QUERY,
      validator: {
        validate: (v) => typeof v === 'boolean',
        defaultMessage: () => '必須是 true 或 false',
      },
    },
    validationOptions,
  );
  return (target, propertyKey) => {
    transform(target, propertyKey);
    validate(target, propertyKey);
  };
}

const NUMBER_STRING = /^\d{1,15}(\.\d{1,3})?$/;

/**
 * query 的數字：只轉換純數字字串（最多 15 位整數、3 位小數），其他值保留原樣交給後面的驗證器擋。
 * 不用 @Type(() => Number)：''、' ' 會變成 0，'0x10' 會變成 16，而且都通過驗證。
 * 沒帶這個參數時 class-transformer 不會呼叫 transform，屬性初始值（例如分頁的預設值）會保留。
 */
export function ToNumber(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = rawValue(obj, key);
    return typeof raw === 'string' && NUMBER_STRING.test(raw)
      ? Number(raw)
      : raw;
  });
}

/** 字串去除前後空白（名稱用）。由全域 ValidationPipe 的 transform: true 套用；service 不另外 trim。 */
export function Trim(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}

/** 去除空白後是空字串時轉成 null（備註用，PRD 13：空字串存成 null）。 */
export function EmptyToNull(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? null : value,
  );
}
