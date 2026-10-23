// 程序時區固定 UTC（台北的「今天」只由 ClockService 提供）。
// 必須是 main.ts 與 seed 腳本的第一個 import：ESM 依 import 順序執行，才會在其他模組之前生效。
process.env.TZ = 'UTC';

export {};

// CI 驗證用，驗證完移除
export const ciLintCheck: any = 1;
