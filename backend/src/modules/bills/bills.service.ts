import { Injectable } from '@nestjs/common';
import {
  addDays,
  fromDbDate,
  toDbDate,
  type DateOnly,
} from '../../common/date-only.js';
import { BillStatus, PrismaService } from '../../prisma/index.js';
import { DUE_SOON_DAYS, summarizeBillAlerts } from './bill-alerts.js';
import type { BillAlerts } from './bill-alerts.types.js';

/**
 * 端點的 service 方法在 BILL-2～7 加入。
 */
@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dashboard 的帳單區塊（BILL-9，規則見 bill-alerts.types.ts）。today 由呼叫端用 ClockService 取得，這裡不取時間。
   * 只讀這位使用者待繳、到期日不晚於今天＋14 天的帳單（逾期的不論多久都算）；計算在 summarizeBillAlerts。
   * 不呼叫 C 的 service；資金缺口由 C 用 dueTotal 計算（Q3）。
   */
  async getBillAlerts(userId: string, today: DateOnly): Promise<BillAlerts> {
    const rows = await this.prisma.bill.findMany({
      where: {
        userId,
        status: BillStatus.pending,
        dueDate: { lte: toDbDate(addDays(today, DUE_SOON_DAYS)) },
      },
      select: {
        id: true,
        name: true,
        amount: true,
        dueDate: true,
        accountId: true,
      },
    });
    return summarizeBillAlerts(
      rows.map((r) => ({ ...r, dueDate: fromDbDate(r.dueDate) })),
      today,
    );
  }
}
