import { ApiProperty } from '@nestjs/swagger';
import { CategoryType } from '../../../prisma/index.js';

/** 分類的回應。P0 只有系統分類，所以不放 userId。 */
export class CategoryResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '7b1d6e2a-3c4f-4a8e-9d10-5e6f7a8b9c0d',
  })
  id!: string;

  @ApiProperty({
    description: '系統分類代碼，唯一，seed 用它 upsert',
    example: 'food',
  })
  code!: string;

  @ApiProperty({ example: '飲食' })
  name!: string;

  @ApiProperty({
    enum: CategoryType,
    enumName: 'CategoryType',
    example: 'expense',
  })
  type!: CategoryType;

  @ApiProperty({
    type: 'integer',
    description: '下拉選單順序，由小到大',
    example: 10,
  })
  sortOrder!: number;
}

/** 不分頁的列表也包一層 items */
export class CategoryListResponseDto {
  @ApiProperty({ type: [CategoryResponseDto] })
  items!: CategoryResponseDto[];
}
