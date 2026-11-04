import { fromDbDate } from '../../common/date-only.js';
import { toMoneyString } from '../../common/money.js';
import type { Loan } from '../../prisma/index.js';
import type { LoanResponseDto } from './dto/loan-response.dto.js';
import { LOAN_TYPE_VALUES, type LoanType } from './dto/loan-type.enum.js';

/**
 * 資料表的一筆貸款 → 回應。不放 userId。
 * - 金額一律 2 位小數字串；interestRate 是 number（3，不是 '3.000'），沒填是 null。
 * - endDate 用 fromDbDate 轉，不受程序時區影響。
 * - loanType 不在清單時丟錯（回 500），不把不認得的值傳給前端（loan_type 是 text 欄位）。
 */
export function toLoanResponse(loan: Loan): LoanResponseDto {
  return {
    id: loan.id,
    name: loan.name,
    loanType: toLoanType(loan.loanType),
    outstandingBalance: toMoneyString(loan.outstandingBalance),
    monthlyPayment: toMoneyString(loan.monthlyPayment),
    paymentDay: loan.paymentDay,
    endDate: fromDbDate(loan.endDate),
    interestRate:
      loan.interestRate === null ? null : loan.interestRate.toNumber(),
    status: loan.status,
    balanceUpdatedAt: loan.balanceUpdatedAt.toISOString(),
    note: loan.note,
    createdAt: loan.createdAt.toISOString(),
    updatedAt: loan.updatedAt.toISOString(),
  };
}

function toLoanType(v: string): LoanType {
  if (!(LOAN_TYPE_VALUES as readonly string[]).includes(v)) {
    throw new Error('toLoanResponse: loan_type 不在 LoanType 清單');
  }
  return v as LoanType;
}
