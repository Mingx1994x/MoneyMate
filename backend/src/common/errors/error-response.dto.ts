import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ERROR_CODE_VALUES, type ErrorCode } from './error-codes.js';

export class ErrorDetailDto {
  @ApiProperty({
    description: '請求中的屬性路徑，與送出的 camelCase 名稱相同',
    example: 'endDate',
  })
  field!: string;

  @ApiProperty({
    enum: ERROR_CODE_VALUES,
    enumName: 'ErrorCode',
    example: 'LOAN_END_DATE_IN_PAST',
  })
  code!: ErrorCode;

  @ApiProperty({
    description: '該代碼在代碼表裡的訊息',
    example: '結清日已經過了，請修改結清日，或把狀態設為已結清',
  })
  message!: string;
}

/** 所有錯誤回應的格式（PRD 13）。/health 的 503 與 /api/v1 以外的未知路徑不在此列。 */
export class ErrorResponseDto {
  @ApiProperty({ type: 'integer', example: 404 })
  statusCode!: number;

  @ApiProperty({
    enum: ERROR_CODE_VALUES,
    enumName: 'ErrorCode',
    description: '前端只用這個判斷；遇到不認得的代碼時顯示 message',
    example: 'LOAN_NOT_FOUND',
  })
  code!: ErrorCode;

  @ApiProperty({
    description: '可直接顯示的繁中句子',
    example: '找不到這筆貸款',
  })
  message!: string;

  @ApiProperty({
    type: [ErrorDetailDto],
    description: '跟欄位有關的錯誤才有內容，否則是空陣列',
  })
  details!: ErrorDetailDto[];

  @ApiProperty({
    description: '與回應標頭 X-Request-Id 相同（INF-5 之後）',
    example: '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10',
  })
  requestId!: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: '只有 429 才有：幾秒後可以再試',
    example: 60,
  })
  retryAfterSeconds?: number;
}
