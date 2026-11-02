import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/pagination.dto.js';
import { BillStatus, Recurrence } from '../../../prisma/index.js';

/**
 * 帳單的回應。不放 userId；帳戶與分類只放 ID，名稱由前端用 /accounts、/categories 對照。
 * 範例是一張還沒繳的每月房租（範例的今天是 2026-10-27）。
 */
export class BillResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5c3a1e8f-7d2b-4f6a-b9e0-1d4c7a2f8b36',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: '同一個重複系列的帳單共用；下一期沿用',
    example: 'a4d7e2c9-1f3b-4a8e-8c6d-2b9f0e7a1c54',
  })
  seriesId!: string;

  @ApiProperty({ example: '房租' })
  name!: string;

  @ApiProperty({ description: '預定金額，金額字串', example: '15000.00' })
  amount!: string;

  @ApiProperty({
    format: 'uuid',
    example: '0b8d3c7e-2f4a-4e6b-9c1d-5a7f8e9b0c21',
  })
  categoryId!: string;

  @ApiProperty({
    format: 'uuid',
    description: '預設扣款帳戶',
    example: '9e2f6a14-3b7c-4d8e-a5f1-6c0b2d4e8a73',
  })
  accountId!: string;

  @ApiProperty({ format: 'date', example: '2026-11-01' })
  dueDate!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 31,
    description: '原始的到期日（例如 31），短月之後用來回到原本的日期',
    example: 1,
  })
  dueDay!: number;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 12,
    description: '每年重複的帳單的到期月份；不是 yearly 時是 null',
    example: null,
  })
  dueMonth!: number | null;

  @ApiProperty({ enum: Recurrence, enumName: 'Recurrence', example: 'monthly' })
  recurrence!: Recurrence;

  @ApiProperty({ enum: BillStatus, enumName: 'BillStatus', example: 'pending' })
  status!: BillStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '實繳金額，金額字串；待繳時是 null',
    example: null,
  })
  paidAmount!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: '繳費日期；待繳時是 null',
    example: null,
  })
  paidDate!: string | null;

  @ApiProperty({
    description: '待繳且 dueDate 早於台北今天（回應時計算，不是資料庫欄位）',
    example: false,
  })
  isOverdue!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '每月 1 日' })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-27T02:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-27T02:30:00.000Z' })
  updatedAt!: string;
}

export class BillListResponseDto extends PageMetaDto {
  @ApiProperty({ type: [BillResponseDto] })
  items!: BillResponseDto[];
}
