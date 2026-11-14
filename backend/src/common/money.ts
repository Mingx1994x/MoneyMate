import { Prisma } from '../prisma/index.js';

/**
 * 金額字串的格式：可帶負號、整數最多 12 位且不得有前導 0、小數最多 2 位（對應 Decimal(14,2)）。
 * 只檢查格式，不檢查正負；正負由 DTO 的 @IsMoney({ sign }) 或 service 檢查。
 * 不可加 g、m flag（g 會讓 test() 帶狀態，m 會讓結尾換行通過）。
 */
export const MONEY_PATTERN = /^-?(0|[1-9]\d{0,11})(\.\d{1,2})?$/;

export function isMoneyString(v: unknown): v is string {
  return typeof v === 'string' && MONEY_PATTERN.test(v);
}

/**
 * 請求的金額字串一律用這個轉成 Decimal，不直接 new Prisma.Decimal(s)：
 * Decimal 也會接受 '0x10'、'1e3'、'Infinity'。
 * 格式不對代表 DTO 驗證漏了，屬於程式錯誤（500），訊息不放輸入值。
 */
export function toMoney(s: string): Prisma.Decimal {
  if (!isMoneyString(s)) {
    throw new Error('toMoney: 金額格式不正確');
  }
  return new Prisma.Decimal(s);
}

/**
 * 回應用的金額字串（固定 2 位小數；Decimal 直接序列化會把 1234.00 變成 "1234"）。
 * 不負責進位：小數超過 2 位代表計算沒有明確進位，直接丟錯，
 * 請在計算裡寫 d.toDecimalPlaces(n, Prisma.Decimal.ROUND_HALF_UP)。
 */
export function toMoneyString(d: Prisma.Decimal): string {
  if (!d.isFinite()) {
    throw new Error('toMoneyString: 金額不是有限值');
  }
  if (d.decimalPlaces() > 2) {
    throw new Error('toMoneyString: 金額超過 2 位小數，請先明確進位');
  }
  return d.toFixed(2);
}
