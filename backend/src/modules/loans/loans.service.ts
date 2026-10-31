import { Injectable, NotImplementedException } from '@nestjs/common';
import type { DateOnly } from '../../common/date-only.js';
import type { LoanSummary } from './loan-summary.types.js';

/**
 * LOAN-1 空殼：先給 C 的 Dashboard 簽名，LOAN-5 實作。端點的 service 方法在 LOAN-2～4 加入。
 */
@Injectable()
export class LoansService {
  /**
   * Dashboard 的貸款摘要（規則見 loan-summary.types.ts）。today 由呼叫端用 ClockService 取得，這裡不取時間。
   */
  getLoanSummary(_userId: string, _today: DateOnly): Promise<LoanSummary> {
    throw new NotImplementedException();
  }
}
