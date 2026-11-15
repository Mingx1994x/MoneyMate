import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { CategoryType } from '../../../prisma/index.js';

export class CategoryListQueryDto {
  @ApiPropertyOptional({
    enum: CategoryType,
    enumName: 'CategoryType',
    description: '只取收入或支出分類；不帶就回全部',
    example: 'expense',
  })
  @IsOptional()
  @IsEnum(CategoryType)
  type?: CategoryType;
}
