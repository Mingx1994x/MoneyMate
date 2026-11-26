import { DASHBOARD_REPORT_BLOCKS } from './dto/dashboard-block.enum.js';
import {
  hidesAllReports,
  normalizeHiddenBlocks,
} from './dashboard-layout.service.js';

describe('normalizeHiddenBlocks', () => {
  it('依固定順序排列', () => {
    expect(normalizeHiddenBlocks(['trend', 'today-bills', 'loans'])).toEqual([
      'today-bills',
      'loans',
      'trend',
    ]);
  });

  it('去重', () => {
    expect(normalizeHiddenBlocks(['trend', 'loans', 'loans'])).toEqual([
      'loans',
      'trend',
    ]);
  });

  it('拿掉不認得的代碼（資料庫裡之後拿掉的舊代碼）', () => {
    expect(normalizeHiddenBlocks(['trend', 'old-block', 'loans'])).toEqual([
      'loans',
      'trend',
    ]);
  });

  it('空陣列還是空陣列', () => {
    expect(normalizeHiddenBlocks([])).toEqual([]);
  });
});

describe('hidesAllReports', () => {
  it('報表 5 個全部隱藏 → true', () => {
    expect(hidesAllReports(DASHBOARD_REPORT_BLOCKS)).toBe(true);
  });

  it('報表隱藏 4 個、留 1 個 → false', () => {
    for (const kept of DASHBOARD_REPORT_BLOCKS) {
      const hidden = DASHBOARD_REPORT_BLOCKS.filter((c) => c !== kept);
      expect(hidesAllReports(hidden)).toBe(false);
    }
  });

  it('第一屏 2 個全部隱藏不受限制 → false', () => {
    expect(hidesAllReports(['today-bills', 'cash-gap'])).toBe(false);
  });

  it('報表 5 個各重複一次，整理後仍是全部隱藏 → true', () => {
    const doubled = [...DASHBOARD_REPORT_BLOCKS, ...DASHBOARD_REPORT_BLOCKS];
    expect(hidesAllReports(normalizeHiddenBlocks(doubled))).toBe(true);
  });
});
