import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiAuth, ApiErrors } from '../../common/swagger/api-decorators.js';
import { CurrentUser, type AuthUser } from '../auth/index.js';
import { CategoriesService } from './categories.service.js';
import { CategoryListQueryDto } from './dto/category-list-query.dto.js';
import { CategoryListResponseDto } from './dto/category-response.dto.js';

/**
 * categories（C）。P0 只有系統分類（user_id 是 null，由 D 的 seed 建立），沒有新增、修改、刪除端點。
 */
@ApiTags('categories')
@ApiAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({
    summary: '列出分類',
    description: [
      '系統分類，不分頁，回傳 { items }。可帶 type=income|expense 只取其中一種；不帶就回全部。',
      '只回 isActive = true 的分類。排序：先類型（income 在前、expense 在後），同類型依 sortOrder 由小到大，再依 id（「其他」的 sortOrder 是 99，排在該類型最後）。',
      'type 不是 income／expense 時回 400 VALIDATION_FAILED（field: type）。',
    ].join('\n\n'),
  })
  @ApiOkResponse({ type: CategoryListResponseDto })
  @ApiErrors('VALIDATION_FAILED')
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: CategoryListQueryDto,
  ): Promise<CategoryListResponseDto> {
    return { items: await this.categories.findAll(user.id, query.type) };
  }
}
