import type { PipeTransform } from '@nestjs/common';
import { ValidateBy, type ValidationOptions } from 'class-validator';
import { AppException, type CodeAllowing } from './errors/app.exception.js';

/** UUID 格式（不分大小寫）；路徑參數的 pipe 與 body／query 的 validator 共用 */
export const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IS_ID = 'isId';

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * 路徑的 :id：不是 UUID 時回該資源的 404（不洩漏、也不送到 @db.Uuid 欄位變成 500）。
 * 不用 Nest 的 ParseUUIDPipe：它回 400。
 *
 * `@Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) _id: string`，另外加 `@ApiParam({ name: 'id', format: 'uuid' })`。
 * 代碼只能是允許 404 的代碼，傳錯會編譯失敗。
 */
export class ParseIdPipe implements PipeTransform<string, string> {
  constructor(private readonly notFoundCode: CodeAllowing<404>) {}

  transform(value: string): string {
    if (!isId(value)) throw new AppException(this.notFoundCode);
    return value;
  }
}

/**
 * body、query 裡的 ID（accountId、categoryId…）：不是 UUID 時失敗。
 * 代碼放在 context，全域 ValidationPipe 依它轉成 400（例如 ACCOUNT_NOT_FOUND），與「格式不合法就當作不存在」一致。
 * 代碼只能是允許 400 的代碼（例如 ACCOUNT_NOT_FOUND 的 alsoAllowed），傳錯會編譯失敗。
 */
export function IsId(
  notFoundCode: CodeAllowing<400>,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_ID,
      validator: {
        validate: (v) => isId(v),
        defaultMessage: () => 'ID 格式不正確',
      },
    },
    { ...validationOptions, context: { code: notFoundCode } },
  );
}
