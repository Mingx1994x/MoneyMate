import {
  Controller,
  Get,
  NotImplementedException,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiAuth,
  ApiErrors,
  ApiNotImplemented,
} from '../../common/swagger/api-decorators.js';
import { CategoryListQueryDto } from './dto/category-list-query.dto.js';
import { CategoryListResponseDto } from './dto/category-response.dto.js';

/**
 * categories 空殼（C）：照 loans 範例寫。
 * - handler 只丟 NotImplementedException（501），不寫 async。
 * - 沒用到的參數加 _ 前綴，實作時拿掉；@CurrentUser() 由 AUTH-1 提供，實作時再加。
 * - 實作 PR 要拿掉 @ApiNotImplemented()。
 * P0 只有系統分類（userId = null，由 seed 建立），沒有新增、修改、刪除端點。
 */
@ApiTags('categories')
@ApiAuth()
@Controller('categories')
export class CategoriesController {
  @Get()
  @ApiOperation({
    summary: '列出分類',
    description: [
      '系統分類，不分頁，回傳 { items }。可帶 type=income|expense 只取其中一種；不帶就回全部。',
      '只回 isActive = true 的分類。排序：sortOrder 由小到大，相同時依 id（「其他」的 sortOrder 最大，排最後）。',
      'type 不是 income／expense 時回 400 VALIDATION_FAILED（field: type）。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: CategoryListResponseDto })
  @ApiErrors('VALIDATION_FAILED')
  @ApiNotImplemented()
  findAll(@Query() _query: CategoryListQueryDto): CategoryListResponseDto {
    throw new NotImplementedException();
  }
}
