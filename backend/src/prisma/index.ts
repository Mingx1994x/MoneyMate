// 業務程式匯入 Prisma 的唯一入口；oxlint 禁止 src/prisma 以外直接 import generated/。
import type { Prisma } from '../generated/prisma/client.js';

export { Prisma } from '../generated/prisma/client.js';
export * from '../generated/prisma/enums.js';
export type {
  Account,
  Bill,
  Category,
  Goal,
  Loan,
  Transaction,
  User,
} from '../generated/prisma/client.js';
export { PrismaModule } from './prisma.module.js';
export { PrismaService } from './prisma.service.js';

/**
 * 跨模組寫入方法的第一個參數：`tx: PrismaTx`（必填，沒有交易時傳 this.prisma）。
 * 讀取方法的最後一個參數選填：`db: PrismaTx = this.prisma`。
 * 交易由 controller 直接呼叫的 service 方法開啟；有 tx 參數的方法內不得再開 $transaction。
 */
export type PrismaTx = Prisma.TransactionClient;
