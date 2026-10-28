import { CategoryType, type PrismaTx } from '../prisma/index.js';

/**
 * 12 個系統分類（PRD FR-12、docs/data-dictionary.md「系統分類」）。
 * code 與前端 labels.ts 一致（前端用它顯示圖示）；改這裡要同步改資料字典，
 * system-categories.spec.ts 會檢查兩邊一致。「其他」的 sort_order 是 99，排在最後。
 */
export const SYSTEM_CATEGORIES = [
  { type: CategoryType.income, code: 'salary', name: '薪資', sortOrder: 1 },
  {
    type: CategoryType.income,
    code: 'investment_income',
    name: '投資收入',
    sortOrder: 2,
  },
  {
    type: CategoryType.income,
    code: 'other_income',
    name: '其他收入',
    sortOrder: 99,
  },
  { type: CategoryType.expense, code: 'food', name: '飲食', sortOrder: 1 },
  { type: CategoryType.expense, code: 'transport', name: '交通', sortOrder: 2 },
  { type: CategoryType.expense, code: 'living', name: '生活', sortOrder: 3 },
  { type: CategoryType.expense, code: 'housing', name: '住房', sortOrder: 4 },
  {
    type: CategoryType.expense,
    code: 'loan_payment',
    name: '貸款還款',
    sortOrder: 5,
  },
  { type: CategoryType.expense, code: 'insurance', name: '保險', sortOrder: 6 },
  { type: CategoryType.expense, code: 'tax', name: '稅費', sortOrder: 7 },
  {
    type: CategoryType.expense,
    code: 'subscription',
    name: '訂閱',
    sortOrder: 8,
  },
  {
    type: CategoryType.expense,
    code: 'other_expense',
    name: '其他',
    sortOrder: 99,
  },
] as const;

/**
 * 建立或更新系統分類，可以重複執行（用 code 當 upsert 的鍵）。
 * - 新增：user_id 是 null（系統分類），is_active 為 true。
 * - 已存在：只更新 name、type、sort_order，不動 is_active（之後如果有人停用某個分類，重跑 seed 不會又打開）。
 * - 不會刪除任何分類，也不會動使用者自己的分類（P1）：code 已被某位使用者的分類用掉時直接丟錯，
 *   不會悄悄改到他的資料。
 * 由 seed 腳本或測試呼叫；有 tx 參數，呼叫的人負責開交易。回傳系統分類的數量。
 */
export async function seedSystemCategories(tx: PrismaTx): Promise<number> {
  for (const { code, name, type, sortOrder } of SYSTEM_CATEGORIES) {
    const existing = await tx.category.findUnique({
      where: { code },
      select: { userId: true },
    });
    if (existing?.userId) {
      throw new Error(
        `seedSystemCategories: code「${code}」已經是使用者的分類，不能當系統分類`,
      );
    }
    await tx.category.upsert({
      where: { code },
      create: { code, name, type, sortOrder },
      update: { name, type, sortOrder },
    });
  }
  return SYSTEM_CATEGORIES.length;
}
