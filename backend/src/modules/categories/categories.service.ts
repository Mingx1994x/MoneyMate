import { Injectable } from '@nestjs/common';
import { CategoryType, PrismaService } from '../../prisma/index.js';
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
}
