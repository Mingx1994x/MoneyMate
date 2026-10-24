import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import type { AllowedStatus } from '../errors/app.exception.js';
import { ERROR_CODES, type ErrorCode } from '../errors/error-codes.js';
import { ErrorResponseDto } from '../errors/error-response.dto.js';

type Decorator = ReturnType<typeof applyDecorators>;

/**
 * 代碼，或 [代碼, 狀態碼]（用在 alsoAllowed，例如 ['ACCOUNT_NOT_FOUND', 400]）。
 * tuple 的狀態碼受代碼表限制，['LOAN_NOT_FOUND', 400] 會編譯失敗。
 */
export type ApiErrorItem =
  ErrorCode | { [C in ErrorCode]: readonly [C, AllowedStatus<C>] }[ErrorCode];

/**
 * 列出這個端點可能的錯誤代碼，依狀態碼分組成 Swagger 的回應。
 * - 每個方法最多一個（寫兩個的話，相同狀態碼會互相覆蓋）；沒有可能的代碼就不寫。
 * - 需要登入的端點不列 401（@ApiAuth 已標註）；公開端點的 401 照列。
 * - 類別上有 @ApiAuth()、方法又要列別的 401 代碼時，方法的 401 會蓋掉類別的，
 *   所以要在這裡一起列 'AUTH_UNAUTHENTICATED'。
 */
export function ApiErrors(...items: ApiErrorItem[]): Decorator {
  const groups = new Map<number, string[]>();
  for (const item of items) {
    const [code, status]: readonly [ErrorCode, number] =
      typeof item === 'string' ? [item, ERROR_CODES[item].status] : item;
    const lines = groups.get(status) ?? [];
    lines.push(`\`${code}\`：${ERROR_CODES[code].message}`);
    groups.set(status, lines);
  }
  return applyDecorators(
    ...[...groups].map(([status, lines]) =>
      // Markdown 的單一換行會被併成同一行，所以用空行分隔
      ApiResponse({
        status,
        type: ErrorResponseDto,
        description: lines.join('\n\n'),
      }),
    ),
  );
}

/**
 * 需要登入：Bearer＋401 AUTH_UNAUTHENTICATED。整個 controller 都要登入時加在類別上；
 * 公開與需登入的端點混在一起（例如 auth）時，加在需要登入的方法上。只負責文件，不擋請求。
 */
export function ApiAuth(): Decorator {
  return applyDecorators(ApiBearerAuth(), ApiErrors('AUTH_UNAUTHENTICATED'));
}

/**
 * 空殼端點：加上 501 回應；buildOpenApiDocument 會在 summary 前加「【未實作】」。
 * 實作 PR 要拿掉，openapi.json 的 diff 就看得出哪支端點完成了。
 */
export function ApiNotImplemented(): Decorator {
  return ApiResponse({
    status: 501,
    type: ErrorResponseDto,
    description: '`NOT_IMPLEMENTED`：這個功能還在開發中',
  });
}
