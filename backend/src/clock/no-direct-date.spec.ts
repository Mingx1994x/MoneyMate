import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import ts from 'typescript';

// 「今天」一律從 ClockService 取得。oxlint 內建規則擋不了沒有參數的 new Date()，
// 所以用 TypeScript 解析語法樹掃描 src/（註解與字串不會誤判）。
// 只防手滑：const D = Date; new D() 這類寫法抓不到，code review 時注意。
const SRC_DIR = join(import.meta.dirname, '..');
const ALLOWED_FILES = new Set(['clock/clock.service.ts']);

/** `Date` 或 `globalThis.Date` */
function isDate(node: ts.Node): boolean {
  return (
    (ts.isIdentifier(node) && node.text === 'Date') ||
    (ts.isPropertyAccessExpression(node) &&
      node.name.text === 'Date' &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'globalThis')
  );
}

/** 回傳違規的位置與寫法，例如 `modules/x.ts:3 new Date()` */
function findDirectDateUsages(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const at = (node: ts.Node, kind: string): void => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    hits.push(`${file}:${line + 1} ${kind}`);
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      isDate(node.expression) &&
      (node.arguments?.length ?? 0) === 0
    ) {
      at(node, 'new Date()');
    } else if (ts.isCallExpression(node) && isDate(node.expression)) {
      // 不加 new 的 Date() 也會回傳現在的時間（字串）
      at(node, 'Date()');
    } else if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'now' &&
      isDate(node.expression)
    ) {
      // 也抓只引用不呼叫的寫法，例如 [].map(Date.now)
      at(node, 'Date.now');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function scanSrc(): string[] {
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
    hits.push(
      ...findDirectDateUsages(file, readFileSync(join(SRC_DIR, file), 'utf8')),
    );
  }
  return hits;
}

describe('src/ 不直接讀系統時間', () => {
  it('沒有 new Date()、Date()、Date.now', () => {
    const hits = scanSrc();
    expect(
      hits,
      `改用 ClockService（src/clock/clock.service.ts）：\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  it('抓得到各種寫法', () => {
    const probe = [
      'const a = new Date();',
      'const b = Date.now();',
      'const c = Date();',
      'const d = [1].map(Date.now);',
      'const e = new globalThis.Date();',
      '/* x */ const f = new Date();',
      'const g = new Date(Date.now());',
    ].join('\n');
    expect(findDirectDateUsages('probe.ts', probe)).toEqual([
      'probe.ts:1 new Date()',
      'probe.ts:2 Date.now',
      'probe.ts:3 Date()',
      'probe.ts:4 Date.now',
      'probe.ts:5 new Date()',
      'probe.ts:6 new Date()',
      'probe.ts:7 Date.now',
    ]);
  });

  it('註解、字串與有參數的 new Date 不算', () => {
    const probe = [
      '// new Date()',
      "const a = 'new Date() is banned'; // was Date.now()",
      "const b = new Date('2026-01-01T00:00:00Z');",
      'const c = new Date(0);',
    ].join('\n');
    expect(findDirectDateUsages('probe.ts', probe)).toEqual([]);
  });
});
