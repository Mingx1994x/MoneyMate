import { ApiProperty } from '@nestjs/swagger';
import { PageMetaDto } from '../../../common/pagination.dto.js';
import { TransactionType } from '../../../prisma/index.js';

/** 交易的回應。不放 userId。 */
export class TransactionResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '5c4b3a29-1807-4f6e-8d5c-4b3a29180765',
  })
  id!: string;

  @ApiProperty({
    enum: TransactionType,
    enumName: 'TransactionType',
    example: 'expense',
  })
  transactionType!: TransactionType;

  @ApiProperty({ description: '金額字串，> 0', example: '120.00' })
  amount!: string;

  @ApiProperty({
    format: 'uuid',
    description: '收入／支出的帳戶；轉帳的轉出帳戶',
    example: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  })
  accountId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '轉入帳戶；只有轉帳有值',
    example: '2b3c4d5e-6f70-4a81-9b2c-3d4e5f607182',
  })
  toAccountId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '分類；轉帳是 null',
    example: '7b1d6e2a-3c4f-4a8e-9d10-5e6f7a8b9c0d',
  })
  categoryId!: string | null;

  @ApiProperty({ format: 'date', example: '2026-10-25' })
  transactionDate!: string;

  @ApiProperty({ type: String, nullable: true, example: '午餐' })
  note!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '產生這筆交易的帳單；不是帳單產生的是 null',
    example: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  })
  billId!: string | null;

  @ApiProperty({
    description:
      '由帳單繳費產生的交易為 true；前端隱藏修改、刪除（後端回 BILL_LINKED_TRANSACTION）',
    example: false,
  })
  isBillGenerated!: boolean;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T04:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T04:30:00.000Z' })
  updatedAt!: string;
}

export class TransactionListResponseDto extends PageMetaDto {
  @ApiProperty({ type: [TransactionResponseDto] })
  items!: TransactionResponseDto[];
}
