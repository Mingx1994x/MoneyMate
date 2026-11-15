import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import {
  CategoryType,
  PrismaService,
  type PrismaTx,
} from '../../prisma/index.js';
import type { CategoryResponseDto } from './dto/category-response.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /categories：啟用中的系統分類（user_id 是 null），加上這位使用者自己的分類（P1 自訂分類用，P0 沒有）。
   * 排序：先類型（income 在前，依 enum 宣告順序），再 sortOrder，最後 id。
   * 系統分類的 sortOrder 收入、支出各自從 1 開始，「其他」是 99（D 的 seed），所以不能只依 sortOrder 排。
   */
  async findAll(
    userId: string,
    type?: CategoryType,
  ): Promise<CategoryResponseDto[]> {
    const rows = await this.prisma.category.findMany({
      where: {
        isActive: true,
        OR: [{ userId: null }, { userId }],
        ...(type ? { type } : {}),
      },
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, type: true, sortOrder: true },
    });
    return rows;
  }

  /**
   * body 引用的分類可以用：存在、啟用中、是系統分類或這位使用者自己的，而且類型相同。
   * 給 transactions 與 E 的帳單用；field 是錯誤 details 的欄位名稱。
   */
  async assertUsable(
    userId: string,
    categoryId: string,
    type: CategoryType,
    field = 'categoryId',
    db: PrismaTx = this.prisma,
  ): Promise<void> {
    const category = await db.category.findFirst({
      where: {
        id: categoryId,
        isActive: true,
        OR: [{ userId: null }, { userId }],
      },
      select: { type: true },
    });
    if (!category) throw AppException.forField('CATEGORY_NOT_FOUND', field);
    if (category.type !== type) {
      throw AppException.forField('CATEGORY_TYPE_MISMATCH', field);
    }
  }
}
