import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { IsDateOnly, IsMoney } from '../../../common/validators.js';
import { BillResponseDto } from './bill-response.dto.js';

/** 兩個欄位都選填，body 可以是空的；可以不帶，但不可為 null */
export class PayBillDto {
  @ApiPropertyOptional({
    description: '實繳金額，金額字串，> 0；不帶時用帳單的 amount',
    example: '15000.00',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsMoney({ sign: 'positive' })
  paidAmount?: string;

  @ApiPropertyOptional({
    format: 'date',
    description:
      '繳費日期，不帶時用台北今天；晚於台北今天回 PAID_DATE_IN_FUTURE（在 service 檢查）',
    example: '2026-10-27',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateOnly()
  paidDate?: string;
}

export class PayBillResponseDto {
  @ApiProperty({ type: BillResponseDto, description: '繳費後的這張帳單' })
  bill!: BillResponseDto;

  @ApiProperty({
    type: BillResponseDto,
    nullable: true,
    description: '產生的下一期待繳帳單；不重複的帳單是 null',
  })
  nextBill!: BillResponseDto | null;
}
