import { ApiProperty } from '@nestjs/swagger';
import { AccountType } from '../../../prisma/index.js';

/** 帳戶的回應。不放 userId；currentBalance 每次查詢時即時計算（PRD 15.1），不存在資料表。 */
export class AccountResponseDto {
  @ApiProperty({
    format: 'uuid',
    example: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  })
  id!: string;

  @ApiProperty({ example: '台新銀行' })
  name!: string;

  @ApiProperty({ enum: AccountType, enumName: 'AccountType', example: 'bank' })
  accountType!: AccountType;

  @ApiProperty({ description: '固定 TWD，不開放輸入', example: 'TWD' })
  currency!: string;

  @ApiProperty({ description: '初始餘額，金額字串', example: '100000.00' })
  openingBalance!: string;

  @ApiProperty({
    description:
      '目前餘額：初始餘額＋收入−支出＋轉入−轉出，只計入日期 ≤ 台北今天的交易。信用卡為負數代表欠款，正數代表溢繳',
    example: '85000.00',
  })
  currentBalance!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({
    description:
      '問卷建立的「現有資產（估計）」帳戶為 true；畫面標示「估計」，不算進可用現金',
    example: false,
  })
  isEstimate!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '建立這個帳戶時從估計帳戶扣掉的金額；沒有扣除時是 null',
    example: '100000.00',
  })
  deductedFromEstimate!: string | null;

  @ApiProperty({
    description:
      '有沒有任何交易（轉出或轉入，含未來日期）。true 時前端只顯示「停用」，false 才顯示「刪除」',
    example: true,
  })
  hasTransactions!: boolean;

  @ApiProperty({ type: String, nullable: true, example: '薪轉戶' })
  note!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T02:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-25T02:30:00.000Z' })
  updatedAt!: string;
}

/** 不分頁的列表也包一層 items */
export class AccountListResponseDto {
  @ApiProperty({ type: [AccountResponseDto] })
  items!: AccountResponseDto[];
}
