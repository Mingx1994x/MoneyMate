/**
 * 列表的 status 篩選。overdue 是計算出來的（待繳且到期日早於台北今天），不是資料庫的 bill_status，
 * 所以不用 Prisma 的 BillStatus。Swagger 用 enumName: 'BillListStatus'。
 */
export const BillListStatus = {
  pending: 'pending',
  paid: 'paid',
  overdue: 'overdue',
} as const;

export type BillListStatus =
  (typeof BillListStatus)[keyof typeof BillListStatus];

export const BILL_LIST_STATUS_VALUES = Object.values(BillListStatus);
