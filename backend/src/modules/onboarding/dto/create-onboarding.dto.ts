import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** 30 秒問卷：只問每月花費（必填）與現有資產（選填） */
export class CreateOnboardingDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1000,
    maximum: 333000,
    description: '財富自由後每月想花多少，整數 1,000–333,000',
    example: 40000,
  })
  @IsInt()
  @Min(1000)
  @Max(333000)
  monthlySpending!: number;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 0,
    maximum: 100000000,
    description:
      '現在大概有多少存款，整數 0–100,000,000；省略或 null 代表跳過（當作 0）',
    example: 800000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  currentAssets?: number | null;
}
