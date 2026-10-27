import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination.dto.js';
import { IsDateOnly } from '../../../common/validators.js';
import {
  BILL_LIST_STATUS_VALUES,
  BillListStatus,
} from './bill-list-status.enum.js';

/** dueFrom 晚於 dueTo 的檢查在 service（VALIDATION_FAILED，field: dueFrom） */
export class BillListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BillListStatus,
    enumName: 'BillListStatus',
    description: 'overdue：待繳且到期日早於台北今天。不帶時列出全部',
    example: 'pending',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(BILL_LIST_STATUS_VALUES)
  status?: BillListStatus;

  @ApiPropertyOptional({
    format: 'date',
    description: '到期日起（含）',
    example: '2026-11-01',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateOnly()
  dueFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: '到期日迄（含），不可早於 dueFrom',
    example: '2026-11-30',
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsDateOnly()
  dueTo?: string;
}
