import { ApiPropertyOptional } from '@nestjs/swagger';
import { ValidateIf } from 'class-validator';
import { IsBooleanQuery } from '../../../common/validators.js';

export class AccountListQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'true 時一併列出停用的帳戶',
    example: false,
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsBooleanQuery()
  includeInactive?: boolean;
}

export class AccountDeleteQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'true 時，把這個帳戶建立時從估計帳戶扣掉的金額（deductedFromEstimate）加回估計帳戶（PRD 15.9）；估計帳戶已停用時會重新啟用。沒有扣除紀錄時忽略。前端的確認視窗預設勾選「加回」，勾選時才帶 true',
    example: true,
  })
  @ValidateIf((_, v) => v !== undefined)
  @IsBooleanQuery()
  addBackToEstimate?: boolean;
}
