import { Injectable } from '@nestjs/common';
import { ClockService } from '../../clock/clock.service.js';
import {
  addYears,
  fromDbDate,
  toDbDate,
  type DateOnly,
} from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { isMoneyString, toMoney, toMoneyString } from '../../common/money.js';
import { LoanStatus, Prisma, PrismaService } from '../../prisma/index.js';
import type { CreateLoanDto } from './dto/create-loan.dto.js';
import type {
  LoanPaymentPreviewQueryDto,
  LoanPaymentPreviewResponseDto,
} from './dto/loan-payment-preview.dto.js';
import type { LoanResponseDto } from './dto/loan-response.dto.js';
import type { UpdateLoanDto } from './dto/update-loan.dto.js';
import { toLoanResponse } from './loan-mapper.js';
import { calcLoanPayment, countInstallments } from './loan-payment.js';
import { summarizeLoans } from './loan-summary.js';
import type { LoanSummary } from './loan-summary.types.js';

/** 結清日最晚到台北今天加幾年（Q12） */
const LOAN_END_DATE_MAX_YEARS = 50;

/**
 * 貸款：CRUD（LOAN-2）、試算（LOAN-4）、Dashboard 摘要（LOAN-5）。
 * - 試算與 getLoanSummary 的 today 由呼叫端用 ClockService 取得。
 * - CRUD 自己從 ClockService 取今天與現在（balanceUpdatedAt）：D 的 demo seed 換成慢 60 天的時鐘建立貸款，
 *   就能做出「餘額 60 天前更新」的資料，create 不用多一個參數。
 * - 查詢一律帶 userId；不存在、屬於他人一律 404 LOAN_NOT_FOUND。
 */
@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
  ) {}

  /** GET /loans：包含已結清，不分頁。active 在前，同組依 createdAt 由新到舊，再依 id */
  async findAll(userId: string): Promise<LoanResponseDto[]> {
    const loans = await this.prisma.loan.findMany({
      where: { userId },
      // LoanStatus 是 PostgreSQL enum，依宣告順序排序：active 在 closed 前面
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
    return loans.map(toLoanResponse);
  }

  /** GET /loans/:id：已結清的也查得到 */
  async findOne(userId: string, id: string): Promise<LoanResponseDto> {
    return toLoanResponse(await this.findOwned(userId, id));
  }

  /**
   * POST /loans。依序檢查：結清日已過但不是 closed（LOAN_END_DATE_IN_PAST）、結清日太遠（Q12），
   * 再決定月付：有帶照存（不檢查是否等於公式值，也不要求小於餘額）；沒帶就用年利率自動算（D-E-002 的期數）。
   * closed 不檢查未償餘額（D-E-003）。
   */
  async create(userId: string, dto: CreateLoanDto): Promise<LoanResponseDto> {
    const today = this.clock.today();
    const status = dto.status ?? LoanStatus.active;
    assertEndDateNotInPast(status, dto.endDate, today);
    assertEndDateNotTooFar(dto.endDate, today);

    const outstandingBalance = toMoney(dto.outstandingBalance);
    const monthlyPayment =
      dto.monthlyPayment === undefined
        ? autoMonthlyPayment(dto, outstandingBalance, today)
        : toMoney(dto.monthlyPayment);

    const loan = await this.prisma.loan.create({
      data: {
        userId,
        name: dto.name,
        loanType: dto.loanType,
        outstandingBalance,
        monthlyPayment,
        paymentDay: dto.paymentDay,
        endDate: toDbDate(dto.endDate),
        interestRate: dto.interestRate ?? null,
        status,
        balanceUpdatedAt: this.clock.now(),
        note: dto.note ?? null,
      },
    });
    return toLoanResponse(loan);
  }

  /**
   * PATCH /loans/:id。沒傳的欄位保持原值；interestRate、note 傳 null 代表清空。
   * - 不重算 monthlyPayment（D-E-001）：沒帶就保持原值。
   * - endDate 或 status 跟原值不同時，才用合併後的值檢查 LOAN_END_DATE_IN_PAST（D-E-004）。
   * - 合併後的結清日不可晚於今天加 50 年（Q12）。
   * - closed 不檢查、也不自動改未償餘額（D-E-003）。
   * - outstandingBalance 跟原值不同才更新 balanceUpdatedAt（Q11）；"317200" 和 "317200.00" 視為相同。
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateLoanDto,
  ): Promise<LoanResponseDto> {
    const today = this.clock.today();
    const current = await this.findOwned(userId, id);
    const currentEndDate = fromDbDate(current.endDate);
    const status = dto.status ?? current.status;
    const endDate = dto.endDate ?? currentEndDate;

    if (status !== current.status || endDate !== currentEndDate) {
      assertEndDateNotInPast(status, endDate, today);
    }
    assertEndDateNotTooFar(endDate, today);

    const outstandingBalance =
      dto.outstandingBalance === undefined
        ? undefined
        : toMoney(dto.outstandingBalance);
    const balanceChanged =
      outstandingBalance !== undefined &&
      !outstandingBalance.equals(current.outstandingBalance);

    const loan = await this.prisma.loan.update({
      where: { id: current.id },
      data: {
        name: dto.name,
        loanType: dto.loanType,
        outstandingBalance,
        monthlyPayment:
          dto.monthlyPayment === undefined
            ? undefined
            : toMoney(dto.monthlyPayment),
        paymentDay: dto.paymentDay,
        endDate: dto.endDate === undefined ? undefined : toDbDate(dto.endDate),
        // undefined：保持原值；null：清空
        interestRate: dto.interestRate,
        status: dto.status,
        note: dto.note,
        ...(balanceChanged ? { balanceUpdatedAt: this.clock.now() } : {}),
      },
    });
    return toLoanResponse(loan);
  }

  /** DELETE /loans/:id：active 也可以刪。貸款和帳單、交易沒有關聯，刪除不影響它們 */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.loan.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new AppException('LOAN_NOT_FOUND');
  }

  /**
   * GET /loans/payment-preview（PRD 15.8、D-E-002）。只計算，不讀寫資料庫。
   * 結清日晚於今天加 50 年回 VALIDATION_FAILED（endDate）；早於今天不擋，期數視為 1。
   */
  paymentPreview(
    query: LoanPaymentPreviewQueryDto,
    today: DateOnly,
  ): LoanPaymentPreviewResponseDto {
    assertEndDateNotTooFar(query.endDate, today);
    const installments = countInstallments(
      today,
      query.paymentDay,
      query.endDate,
    );
    const { monthlyPayment, totalInterest } = calcLoanPayment({
      balance: toMoney(query.outstandingBalance),
      annualRatePercent: query.interestRate,
      installments,
    });
    return {
      monthlyPayment: toMoneyString(monthlyPayment),
      totalInterest: toMoneyString(totalInterest),
      installments,
    };
  }

  /**
   * Dashboard 的貸款摘要（LOAN-5，規則見 loan-summary.types.ts）。today 由呼叫端用 ClockService 取得，這裡不取時間。
   * 只讀這位使用者 active 的貸款；計算在 summarizeLoans。
   */
  async getLoanSummary(userId: string, today: DateOnly): Promise<LoanSummary> {
    const rows = await this.prisma.loan.findMany({
      where: { userId, status: LoanStatus.active },
      select: {
        id: true,
        name: true,
        outstandingBalance: true,
        monthlyPayment: true,
        paymentDay: true,
        endDate: true,
      },
    });
    return summarizeLoans(
      rows.map((r) => ({ ...r, endDate: fromDbDate(r.endDate) })),
      today,
    );
  }

  private async findOwned(userId: string, id: string) {
    const loan = await this.prisma.loan.findFirst({ where: { id, userId } });
    if (!loan) throw new AppException('LOAN_NOT_FOUND');
    return loan;
  }
}

/** status 不是 closed 而且結清日早於台北今天 → LOAN_END_DATE_IN_PAST（PRD 第十三節） */
function assertEndDateNotInPast(
  status: LoanStatus,
  endDate: DateOnly,
  today: DateOnly,
): void {
  if (status !== LoanStatus.closed && endDate < today) {
    throw AppException.forField('LOAN_END_DATE_IN_PAST', 'endDate');
  }
}

/** 結清日不可晚於台北今天加 50 年（Q12）；試算、新增、修改共用 */
function assertEndDateNotTooFar(endDate: DateOnly, today: DateOnly): void {
  if (endDate > addYears(today, LOAN_END_DATE_MAX_YEARS)) {
    throw AppException.forField('VALIDATION_FAILED', 'endDate');
  }
}

/**
 * POST 沒帶 monthlyPayment 時用年利率自動算（PRD 15.8，期數照 D-E-002，跟試算同一條公式）。
 * 沒有年利率，或算出來不是正數（例如未償餘額 0）、超過金額上限 → LOAN_MONTHLY_PAYMENT_REQUIRED，請使用者自己填。
 */
function autoMonthlyPayment(
  dto: CreateLoanDto,
  balance: Prisma.Decimal,
  today: DateOnly,
): Prisma.Decimal {
  if (dto.interestRate === undefined || dto.interestRate === null) {
    throw AppException.forField(
      'LOAN_MONTHLY_PAYMENT_REQUIRED',
      'monthlyPayment',
    );
  }
  const { monthlyPayment } = calcLoanPayment({
    balance,
    annualRatePercent: dto.interestRate,
    installments: countInstallments(today, dto.paymentDay, dto.endDate),
  });
  // 超過金額上限（整數 12 位）的情況只有極端的輸入會發生，存不進資料庫，一樣請使用者自己填
  if (!monthlyPayment.gt(0) || !isMoneyString(monthlyPayment.toFixed(2))) {
    throw AppException.forField(
      'LOAN_MONTHLY_PAYMENT_REQUIRED',
      'monthlyPayment',
    );
  }
  return monthlyPayment;
}
