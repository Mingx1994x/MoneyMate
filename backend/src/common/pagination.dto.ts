import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { ToNumber } from './validators.js';

/**
 * 分頁列表的 query：`TransactionListQueryDto extends PaginationQueryDto`。
 * 預設值寫在屬性初始值；Swagger 看不到初始值（沒開 CLI plugin），所以 default 要手寫。
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ type: 'integer', default: 1, minimum: 1 })
  @ToNumber()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    type: 'integer',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

/** 分頁列表的回應：`TransactionListResponseDto extends PageMetaDto`，再加 items */
export class PageMetaDto {
  @ApiProperty({ type: 'integer', minimum: 1, example: 1 })
  page!: number;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 100, example: 20 })
  pageSize!: number;

  @ApiProperty({ type: 'integer', minimum: 0, example: 42 })
  total!: number;
}
