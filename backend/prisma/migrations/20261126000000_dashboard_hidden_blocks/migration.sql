-- D-A-008：Dashboard 隱藏的區塊代碼，空陣列＝全部顯示
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dashboard_hidden_blocks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
