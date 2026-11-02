import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SYSTEM_CATEGORIES } from './system-categories.js';

// repo 根目錄的 docs/data-dictionary.md（CI 的 backend job 會 checkout 整個 repo）
const MD_PATH = fileURLToPath(
  new URL('../../../docs/data-dictionary.md', import.meta.url),
);

interface MdRow {
  type: string;
  name: string;
  sortOrder: number;
}

/** 解析資料字典「系統分類」表中的列：`| income | \`salary\` | 薪資 | 1 |` */
function parseMd(markdown: string): Map<string, MdRow> {
  const rows = new Map<string, MdRow>();
  for (const line of markdown.split('\n')) {
    const match =
      /^\|\s*(income|expense)\s*\|\s*`([a-z_]+)`\s*\|([^|]+)\|\s*(\d+)\s*\|/.exec(
        line,
      );
    if (!match) continue;
    const [, type, code, name, sortOrder] = match;
    if (rows.has(code)) throw new Error(`資料字典重複的分類代碼：${code}`);
    rows.set(code, { type, name: name.trim(), sortOrder: Number(sortOrder) });
  }
  return rows;
}

describe('系統分類（FR-12）', () => {
  it('共 12 個：3 個收入、9 個支出', () => {
    expect(SYSTEM_CATEGORIES).toHaveLength(12);
    expect(SYSTEM_CATEGORIES.filter((c) => c.type === 'income')).toHaveLength(
      3,
    );
    expect(SYSTEM_CATEGORIES.filter((c) => c.type === 'expense')).toHaveLength(
      9,
    );
  });

  it('code 不重複，而且是小寫英文與底線', () => {
    const codes = SYSTEM_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it('每個類型內 sort_order 不重複，「其他」排最後（99）', () => {
    for (const type of ['income', 'expense']) {
      const rows = SYSTEM_CATEGORIES.filter((c) => c.type === type);
      const orders = rows.map((c) => c.sortOrder);
      expect(new Set(orders).size).toBe(orders.length);
      const last = rows.reduce((a, b) => (b.sortOrder > a.sortOrder ? b : a));
      expect(last.code).toBe(
        type === 'income' ? 'other_income' : 'other_expense',
      );
      expect(last.sortOrder).toBe(99);
    }
  });

  it('和 docs/data-dictionary.md 的「系統分類」表完全一致（代碼、類型、名稱、順序）', () => {
    const md = parseMd(readFileSync(MD_PATH, 'utf8'));
    expect([...md.keys()].sort()).toEqual(
      SYSTEM_CATEGORIES.map((c) => c.code).sort(),
    );
    for (const c of SYSTEM_CATEGORIES) {
      expect(md.get(c.code), c.code).toEqual({
        type: c.type,
        name: c.name,
        sortOrder: c.sortOrder,
      });
    }
  });
});
