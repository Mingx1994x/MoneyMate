/**
 * 貸款類型。DB 的 loan_type 是 text，值由這裡定義（seed 也匯入這個常數，不手寫字串）；
 * 中文標籤由前端處理。寫法和 Prisma 產生的 enum 相同，Swagger 用 enumName: 'LoanType'。
 */
export const LoanType = {
  mortgage: 'mortgage',
  car: 'car',
  personal: 'personal',
  student: 'student',
  other: 'other',
} as const;

export type LoanType = (typeof LoanType)[keyof typeof LoanType];

export const LOAN_TYPE_VALUES = Object.values(LoanType);
