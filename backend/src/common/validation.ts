import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { AppException, type CodeAllowing } from './errors/app.exception.js';
import {
  detail,
  ERROR_CODES,
  type ErrorCode,
  type ErrorCodeDef,
  type ErrorDetail,
} from './errors/error-codes.js';
import { IS_ID } from './id.js';
import {
  IS_MONEY,
  IS_NAME,
  MONEY_NON_NEGATIVE,
  MONEY_POSITIVE,
} from './validators.js';

/**
 * 有專屬代碼的 constraint，依優先順序（格式一定先於正負）；isId 另外處理（代碼在 context）。
 * 不用「取第一個 constraint」：constraints 的鍵順序與裝飾器順序相反，結果會取決於裝飾器的排列。
 */
const CODE_BY_CONSTRAINT = [
  [IS_MONEY, 'AMOUNT_INVALID'],
  [MONEY_POSITIVE, 'AMOUNT_NOT_POSITIVE'],
  [MONEY_NON_NEGATIVE, 'AMOUNT_NEGATIVE'],
  [IS_NAME, 'NAME_INVALID'],
] as const satisfies readonly (readonly [string, CodeAllowing<400>])[];

/** 回應最多帶幾筆 details：避免大量未宣告欄位換來數倍大的回應 */
const MAX_DETAILS = 20;

/**
 * 全域 ValidationPipe，只在 configureApp 註冊。
 * - 不開 transformOptions.enableImplicitConversion：會把 JSON 的數字 1234.5 轉成字串、繞過「金額必須是字串」。
 * - 錯誤物件不帶請求的值與整個物件，萬一被記進日誌也不會外洩。
 * - validateCustomDecorators 維持預設 false：@CurrentUser() 這類參數不拿去驗證。
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) => toValidationException(errors),
  });
}

/** 驗證失敗轉成 400：每個欄位一筆 details（最多 20 筆），頂層代碼等於第一筆。 */
export function toValidationException(errors: ValidationError[]): AppException {
  const details = toValidationDetails(errors);
  const first = details[0];
  if (first === undefined) return new AppException('BAD_REQUEST');
  return new AppException(first.code, {
    status: 400,
    details: details.slice(0, MAX_DETAILS),
  });
}

/**
 * ValidationError 樹轉成 details：field 是屬性路徑（items.1.amount）。
 * 節點有 constraints 就產生一筆；children 一律繼續遞迴（同一個節點可以兩者都有）。
 */
export function toValidationDetails(
  errors: ValidationError[],
  parent = '',
): ErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent === '' ? e.property : `${parent}.${e.property}`;
    const own = e.constraints ? [detail(field, codeFor(e))] : [];
    return [...own, ...toValidationDetails(e.children ?? [], field)];
  });
}

function codeFor(e: ValidationError): CodeAllowing<400> {
  const names = Object.keys(e.constraints ?? {});
  if (names.includes(IS_ID)) return idCode(e);
  for (const [name, code] of CODE_BY_CONSTRAINT) {
    if (names.includes(name)) return code;
  }
  return 'VALIDATION_FAILED';
}

// @IsId 把代碼放在 context；型別擋得住傳錯，這裡再檢查一次（contexts 的型別是 any）
function idCode(e: ValidationError): CodeAllowing<400> {
  const ctx: unknown = e.contexts?.[IS_ID];
  const code =
    typeof ctx === 'object' && ctx !== null
      ? (ctx as { code?: unknown }).code
      : undefined;
  if (!isCodeAllowing400(code)) {
    throw new Error('toValidationDetails: isId context has no valid code');
  }
  return code;
}

// 不用 `code in ERROR_CODES`：'toString'、'constructor' 也會通過
function isCodeAllowing400(c: unknown): c is CodeAllowing<400> {
  if (typeof c !== 'string' || !Object.hasOwn(ERROR_CODES, c)) return false;
  const def: ErrorCodeDef = ERROR_CODES[c as ErrorCode];
  return def.status === 400 || (def.alsoAllowed?.includes(400) ?? false);
}
