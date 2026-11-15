import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, ValidateIf } from 'class-validator';
import {
  EmptyToNull,
  IsMoney,
  IsName,
  IsNote,
  Trim,
} from '../../../common/validators.js';
import { AccountType } from '../../../prisma/index.js';

export class CreateAccountDto {
  @ApiProperty({
    description: '帳戶名稱，去除前後空白後 1–30 字',
    minLength: 1,
    maxLength: 30,
    example: '台新銀行',
  })
  @Trim()
  @IsName()
  name!: string;

  @ApiProperty({
    enum: AccountType,
    enumName: 'AccountType',
    description: '建立後不能修改',
    example: 'bank',
  })
  @IsEnum(AccountType)
  accountType!: AccountType;

  @ApiProperty({
    description:
      '初始餘額，金額字串。只有 credit_card 可以是負數（代表欠款），其他類型為負數時回 OPENING_BALANCE_NEGATIVE',
    example: '100000.00',
  })
  // 正負依 accountType 決定，在 service 檢查
  @IsMoney({ sign: 'any' })
  openingBalance!: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      '是否從「現有資產（估計）」扣掉這個帳戶的初始餘額（PRD 15.9）。實際扣除 = min(初始餘額, 估計帳戶目前餘額)；這個金額 ≤ 0 時不扣、不報錯，deductedFromEstimate 存 null（初始餘額 ≤ 0、估計帳戶目前餘額 ≤ 0、沒有估計帳戶或估計帳戶已停用）',
    example: true,
  })
  // 可以不帶，但不可為 null
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  deductFromEstimate?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 200,
    description: '備註，最多 200 字；空字串存成 null',
    example: '薪轉戶',
  })
  @IsOptional()
  @EmptyToNull()
  @IsNote()
  note?: string | null;
}
