import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

// 「今天」一律從 ClockService 取得。oxlint 沒有 no-restricted-syntax，擋不了沒有參數的 new Date()，
// 所以用這個測試掃描 src/。只防手滑：const D = Date; new D() 這類寫法抓不到，code review 時注意。
const SRC_DIR = join(import.meta.dirname, '..');
const BANNED = [/\bnew\s+Date\s*\(\s*\)/, /\bDate\.now\s*\(/];
const ALLOWED_FILES = new Set(['clock/clock.service.ts']);

function findDirectDateUsages(): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(SRC_DIR, { recursive: true })) {
    const file = String(entry).split(sep).join('/');
    if (
      !file.endsWith('.ts') ||
      file.endsWith('.spec.ts') ||
      file.startsWith('generated/') ||
      ALLOWED_FILES.has(file)
    ) {
      continue;
    }
    readFileSync(join(SRC_DIR, file), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const trimmed = line.trim();
        // 註解裡可以提到 new Date()（例如 date-only.ts 的說明）
        if (/^(\/\/|\/\*|\*)/.test(trimmed)) return;
        if (BANNED.some((re) => re.test(line))) hits.push(`${file}:${i + 1}`);
      });
  }
  return hits;
}

describe('src/ 不直接讀系統時間', () => {
  it('沒有 new Date()、Date.now()', () => {
    const hits = findDirectDateUsages();
    expect(
      hits,
      `改用 ClockService（src/clock/clock.service.ts）：\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
