import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, type ErrorCodeDef } from './error-codes.js';

// repo 根目錄的 docs/error-codes.md（CI 的 backend job 會 checkout 整個 repo）
const MD_PATH = fileURLToPath(
  new URL('../../../../docs/error-codes.md', import.meta.url),
);

interface MdRow {
  statuses: number[];
  message: string;
}

/**
 * 解析表格中以 `CODE` 開頭的列：代碼、HTTP（可寫 404／400）、訊息。
 * 儲存格前後的空白長度不限：Prettier 或編輯器格式化 md 時會補空白對齊欄位。
 */
function parseMd(markdown: string): Map<string, MdRow> {
  const rows = new Map<string, MdRow>();
  for (const line of markdown.split('\n')) {
    const match = /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|([^|]+)\|([^|]+)\|/.exec(line);
    if (!match) continue;
    const [, code, http, message] = match;
    if (rows.has(code))
      throw new Error(`docs/error-codes.md 重複的代碼：${code}`);
    rows.set(code, {
      statuses: http.split('／').map((s) => Number(s.trim())),
      message: message.trim(),
    });
  }
  return rows;
}

describe('錯誤代碼表與 docs/error-codes.md 一致', () => {
  const md = parseMd(readFileSync(MD_PATH, 'utf8'));
  const codes = Object.entries(ERROR_CODES as Record<string, ErrorCodeDef>);

  it('兩邊的代碼集合相同', () => {
    expect([...md.keys()].sort()).toEqual(codes.map(([code]) => code).sort());
  });

  it.each(codes)('%s 的 HTTP 與訊息相同', (code, def) => {
    const row = md.get(code);
    expect(row).toBeDefined();
    expect(row?.statuses).toEqual([def.status, ...(def.alsoAllowed ?? [])]);
    expect(row?.message).toBe(def.message);
  });
});
