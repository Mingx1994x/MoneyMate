import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../prisma/index.js';
import {
  DASHBOARD_BLOCK_VALUES,
  DASHBOARD_REPORT_BLOCKS,
  type DashboardBlock,
} from './dto/dashboard-block.enum.js';
import type { DashboardLayoutResponseDto } from './dto/dashboard-layout.dto.js';

/**
 * 把隱藏清單整理成固定的樣子：去重、拿掉不認得的代碼、依 DashboardBlock 的宣告順序排列。
 * hiddenBlocks 是「一組區塊」，順序與重複都不影響意思；整理後同樣的設定一定存成同樣的值。
 */
export function normalizeHiddenBlocks(
  input: readonly string[],
): DashboardBlock[] {
  const set = new Set(input);
  return DASHBOARD_BLOCK_VALUES.filter((code) => set.has(code));
}

/** 報表的區塊是否全部隱藏（D-A-008：至少要留一個）；傳入整理過的清單 */
export function hidesAllReports(hidden: readonly DashboardBlock[]): boolean {
  return DASHBOARD_REPORT_BLOCKS.every((code) => hidden.includes(code));
}

/**
 * GET／PUT /dashboard/layout（D-A-008）。只讀寫 users.dashboard_hidden_blocks，不影響 /dashboard/summary 的計算。
 * token 對應的使用者不存在時（例如資料庫被重設）回 401 AUTH_UNAUTHENTICATED，和 /auth/me 相同。
 */
@Injectable()
export class DashboardLayoutService {
  constructor(private readonly prisma: PrismaService) {}

  async getLayout(userId: string): Promise<DashboardLayoutResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dashboardHiddenBlocks: true },
    });
    if (!user) throw new AppException('AUTH_UNAUTHENTICATED');
    // 資料庫裡可能有之後拿掉的舊代碼，回傳前過濾
    return { hiddenBlocks: normalizeHiddenBlocks(user.dashboardHiddenBlocks) };
  }

  async updateLayout(
    userId: string,
    input: readonly DashboardBlock[],
  ): Promise<DashboardLayoutResponseDto> {
    const hiddenBlocks = normalizeHiddenBlocks(input);
    if (hidesAllReports(hiddenBlocks)) {
      throw AppException.forField('DASHBOARD_REPORT_REQUIRED', 'hiddenBlocks');
    }
    // 只有一個寫入，不用開交易；用 updateMany 看 count，不靠 update 的 P2025（README「錯誤處理」）
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { dashboardHiddenBlocks: hiddenBlocks },
    });
    if (count === 0) throw new AppException('AUTH_UNAUTHENTICATED');
    return { hiddenBlocks };
  }
}
