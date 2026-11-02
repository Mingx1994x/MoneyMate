import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { BillResponseDto } from './bill-response.dto.js';

export class StopRecurrenceDto {
  @ApiProperty({
    description:
      '系列中的待繳帳單：true 保留並改成不重複；false 刪除。必填，沒帶或不是布林回 VALIDATION_FAILED',
    example: true,
  })
  @IsBoolean()
  keepCurrent!: boolean;
}

export class StopRecurrenceResponseDto {
  @ApiProperty({
    description: '系列有待繳帳單（已處理）時是 true；沒有待繳帳單時是 false',
    example: true,
  })
  stopped!: boolean;

  @ApiProperty({
    type: BillResponseDto,
    nullable: true,
    description: '保留時是改成不重複後的待繳帳單；刪除或沒有待繳帳單時是 null',
  })
  bill!: BillResponseDto | null;
}
