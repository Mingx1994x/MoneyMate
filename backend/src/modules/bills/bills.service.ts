import { Injectable, NotImplementedException } from '@nestjs/common';
import type { DateOnly } from '../../common/date-only.js';
import type { BillAlerts } from './bill-alerts.types.js';

/**
 * BILL-1 空殼：先給 C 的 Dashboard 簽名，BILL-9 實作。端點的 service 方法在 BILL-2～7 加入。
 */
@Injectable()
export class BillsService {
  /**
   * Dashboard 的帳單區塊（規則見 bill-alerts.types.ts）。today 由呼叫端用 ClockService 取得，這裡不取時間。
   * 只讀帳單表，不呼叫 C 的 service；資金缺口由 C 用 dueTotal 計算（Q3）。
   */
  getBillAlerts(_userId: string, _today: DateOnly): Promise<BillAlerts> {
    throw new NotImplementedException();
  }
}
