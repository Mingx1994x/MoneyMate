-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('cash', 'bank', 'investment', 'credit_card');

-- CreateEnum
CREATE TYPE "category_type" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('income', 'expense', 'transfer');

-- CreateEnum
CREATE TYPE "loan_status" AS ENUM ('active', 'closed');

-- CreateEnum
CREATE TYPE "recurrence" AS ENUM ('none', 'monthly', 'yearly');

-- CreateEnum
CREATE TYPE "bill_status" AS ENUM ('pending', 'paid');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "account_type" "account_type" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "opening_balance" DECIMAL(14,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_estimate" BOOLEAN NOT NULL DEFAULT false,
    "deducted_from_estimate" DECIMAL(14,2),
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "category_type" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "transaction_type" "transaction_type" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category_id" UUID,
    "to_account_id" UUID,
    "transaction_date" DATE NOT NULL,
    "note" TEXT,
    "bill_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "loan_type" TEXT NOT NULL,
    "outstanding_balance" DECIMAL(14,2) NOT NULL,
    "monthly_payment" DECIMAL(14,2) NOT NULL,
    "payment_day" INTEGER NOT NULL,
    "end_date" DATE NOT NULL,
    "interest_rate" DECIMAL(6,3),
    "status" "loan_status" NOT NULL DEFAULT 'active',
    "balance_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "category_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "due_date" DATE NOT NULL,
    "due_day" INTEGER NOT NULL,
    "due_month" INTEGER,
    "series_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recurrence" "recurrence" NOT NULL DEFAULT 'none',
    "status" "bill_status" NOT NULL DEFAULT 'pending',
    "paid_amount" DECIMAL(14,2),
    "paid_date" DATE,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '財富自由',
    "monthly_spending" DECIMAL(14,2) NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "target_date" DATE,
    "birth_year" INTEGER,
    "est_monthly_saving" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_id_user_id_key" ON "accounts"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_bill_id_key" ON "transactions"("bill_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_transaction_date_idx" ON "transactions"("user_id", "transaction_date");

-- CreateIndex
CREATE INDEX "transactions_account_id_idx" ON "transactions"("account_id");

-- CreateIndex
CREATE INDEX "transactions_to_account_id_idx" ON "transactions"("to_account_id");

-- CreateIndex
CREATE INDEX "loans_user_id_idx" ON "loans"("user_id");

-- CreateIndex
CREATE INDEX "bills_user_id_due_date_idx" ON "bills"("user_id", "due_date");

-- CreateIndex
CREATE INDEX "bills_series_id_due_date_idx" ON "bills"("series_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "goals_user_id_key" ON "goals"("user_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_user_id_fkey" FOREIGN KEY ("account_id", "user_id") REFERENCES "accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_user_id_fkey" FOREIGN KEY ("to_account_id", "user_id") REFERENCES "accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_account_id_user_id_fkey" FOREIGN KEY ("account_id", "user_id") REFERENCES "accounts"("id", "user_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 以下為手動加入：Prisma schema 寫不出來的 CHECK 與部分唯一索引
-- 清單與說明見 docs/data-dictionary.md「手動加在 migration 的規則」；自動測試在 test/db-constraints.e2e-spec.ts
-- 跟「今天」有關的規則（paid_date 不晚於今天等）不寫成 CHECK：資料庫的 current_date 是 UTC，「今天」以台北時間為準，留給 service
-- ─────────────────────────────────────────────────────────────

-- users：Email 一律小寫
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"));

-- accounts：幣別固定 TWD（PRD 第五節不做多幣別）
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_check" CHECK ("currency" = 'TWD');

-- accounts：初始餘額不可為負，信用卡與估計帳戶除外（PRD 15.9 扣除後估計帳戶的初始餘額可能變負）
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_opening_balance_check"
  CHECK ("account_type" = 'credit_card' OR "is_estimate" OR "opening_balance" >= 0);

-- accounts：估計帳戶的類型固定是 bank（PRD 第十四節）
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_estimate_is_bank_check"
  CHECK (NOT "is_estimate" OR "account_type" = 'bank');

-- accounts：從估計帳戶扣除的金額不存 0，沒扣就存 null
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_deducted_from_estimate_check"
  CHECK ("deducted_from_estimate" IS NULL OR "deducted_from_estimate" > 0);

-- accounts：每位使用者最多 1 個估計帳戶
CREATE UNIQUE INDEX "accounts_one_estimate_per_user" ON "accounts"("user_id") WHERE "is_estimate";

-- transactions：金額一定大於 0，方向由類型決定
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_check" CHECK ("amount" > 0);

-- transactions：轉帳要有轉入帳戶、沒有分類、兩個帳戶不同；收入／支出要有分類、沒有轉入帳戶
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_fields_check" CHECK (
  ("transaction_type" = 'transfer'
    AND "to_account_id" IS NOT NULL AND "category_id" IS NULL AND "account_id" <> "to_account_id")
  OR ("transaction_type" IN ('income', 'expense')
    AND "category_id" IS NOT NULL AND "to_account_id" IS NULL)
);

-- loans：數值範圍（PRD 第十三、十四節）
ALTER TABLE "loans" ADD CONSTRAINT "loans_values_check" CHECK (
  "outstanding_balance" >= 0 AND "monthly_payment" > 0 AND "payment_day" BETWEEN 1 AND 31
  AND ("interest_rate" IS NULL OR "interest_rate" BETWEEN 0 AND 100)
);

-- bills：已繳時實繳金額與日期必須有值；待繳時必須是 null
ALTER TABLE "bills" ADD CONSTRAINT "bills_paid_fields_check" CHECK (
  ("status" = 'paid' AND "paid_amount" IS NOT NULL AND "paid_date" IS NOT NULL)
  OR ("status" = 'pending' AND "paid_amount" IS NULL AND "paid_date" IS NULL)
);

-- bills：數值範圍；yearly 一定要有 due_month（反過來不檢查：停止重複後 none 仍保留 due_month）
ALTER TABLE "bills" ADD CONSTRAINT "bills_values_check" CHECK (
  "amount" > 0 AND ("paid_amount" IS NULL OR "paid_amount" > 0)
  AND "due_day" BETWEEN 1 AND 31 AND ("due_month" IS NULL OR "due_month" BETWEEN 1 AND 12)
  AND ("recurrence" <> 'yearly' OR "due_month" IS NOT NULL)
);

-- bills：同一系列最多 1 張待繳。部分唯一索引不能延後檢查，
-- 繳費要先把本期改成 paid 再新增下一期；取消繳費要先刪下一期再把本期改回 pending
CREATE UNIQUE INDEX "bills_one_pending_per_series" ON "bills"("series_id") WHERE "status" = 'pending';

-- goals：每月花費 1,000–333,000 的整數（PRD 第十三節）；目標金額 = 每月花費 × 300（PRD 15.3）
ALTER TABLE "goals" ADD CONSTRAINT "goals_monthly_spending_check"
  CHECK ("monthly_spending" BETWEEN 1000 AND 333000 AND "monthly_spending" = trunc("monthly_spending"));
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_amount_check"
  CHECK ("target_amount" = "monthly_spending" * 300);
