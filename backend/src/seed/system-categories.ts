import { CategoryType, Prisma, type PrismaTx } from '../prisma/index.js';

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
 * 建立或更新系統分類，可以重複執行（用 code 當衝突的鍵）。
 * - 新增：user_id 是 null（系統分類），is_active 為 true。
 * - 已存在：只更新 name、type、sort_order，不動 is_active（之後如果有人停用某個分類，重跑 seed 不會又打開）。
 * - 不會刪除任何分類，也不會動使用者自己的分類（P1）：code 已被某位使用者的分類用掉時，
 *   那一列不會被更新，函式丟錯（呼叫的交易跟著回滾），不會悄悄改到他的資料。
 *
 * 12 筆用一個 INSERT … ON CONFLICT 寫入，而不是逐筆 findUnique＋upsert：
 * - 一次來回：從遠端（Supabase）執行時，24 次連續查詢可能超過互動式交易的 10 秒上限。
 * - 不可分割：「user_id IS NULL 才更新」由資料庫在同一個動作內判斷，兩個 seed 同時跑、
 *   或有人同時新增分類，都不會讓檢查與寫入之間被插隊。
 * 由 seed 腳本或測試呼叫；有 tx 參數，呼叫的人負責開交易。回傳系統分類的數量。
 */
export async function seedSystemCategories(tx: PrismaTx): Promise<number> {
  const values = Prisma.join(
    SYSTEM_CATEGORIES.map(
      (c) =>
        Prisma.sql`(${c.code}, ${c.name}, ${c.type}::"category_type", ${c.sortOrder})`,
    ),
  );
  // 衝突的那一列若是使用者的分類，WHERE 不成立，不會更新也不會出現在 RETURNING
  const written = await tx.$queryRaw<{ code: string }[]>`
    INSERT INTO categories (code, name, type, sort_order)
    VALUES ${values}
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name, type = EXCLUDED.type, sort_order = EXCLUDED.sort_order
      WHERE categories.user_id IS NULL
    RETURNING code`;

  if (written.length !== SYSTEM_CATEGORIES.length) {
    const done = new Set(written.map((r) => r.code));
    const clashes = SYSTEM_CATEGORIES.filter((c) => !done.has(c.code)).map(
      (c) => c.code,
    );
    throw new Error(
      `seedSystemCategories: code「${clashes.join('、')}」已經是使用者的分類，不能當系統分類`,
    );
  }
  return SYSTEM_CATEGORIES.length;
}
