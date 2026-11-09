import { Injectable, Logger } from '@nestjs/common';
import { ClockService } from '../../clock/clock.service.js';
import {
  addDays,
  fromDbDate,
  toDbDate,
  type DateOnly,
} from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { toMoney } from '../../common/money.js';
import {
  BillStatus,
  CategoryType,
  Prisma,
  PrismaService,
  Recurrence,
  type Bill,
  type PrismaTx,
} from '../../prisma/index.js';
import { AccountsService } from '../accounts/index.js';
import { CategoriesService } from '../categories/index.js';
import { TransactionsService } from '../transactions/index.js';
import { DUE_SOON_DAYS, summarizeBillAlerts } from './bill-alerts.js';
import type { BillAlerts } from './bill-alerts.types.js';
import { toBillResponse } from './bill-mapper.js';
import {
  assertDueDateNotTooFar,
  dueDayOf,
  dueMonthOf,
  nextPeriodData,
  splitPage,
  stopsOnUnpay,
} from './bill-rules.js';
import type { BillListQueryDto } from './dto/bill-list-query.dto.js';
import { BillListStatus } from './dto/bill-list-status.enum.js';
import type {
  BillListResponseDto,
  BillResponseDto,
} from './dto/bill-response.dto.js';
import type { CreateBillDto } from './dto/create-bill.dto.js';
import type { PayBillDto, PayBillResponseDto } from './dto/pay-bill.dto.js';
import type {
  StopRecurrenceDto,
  StopRecurrenceResponseDto,
} from './dto/stop-recurrence.dto.js';
import type { UpdateBillDto } from './dto/update-bill.dto.js';

/**
 * 帳單：CRUD（BILL-2）、列表（BILL-3）、繳費（BILL-5）、取消繳費（BILL-6）、停止重複（BILL-7），
 * 以及 Dashboard 的帳單區塊（BILL-9）。
 * - 端點方法開頭從 ClockService 取一次今天，往下傳。
 * - 查詢一律帶 userId；不存在、屬於他人一律 404 BILL_NOT_FOUND。
 * - 修改、刪除、繳費、取消繳費、停止重複先鎖定整個系列（FOR UPDATE），鎖定後重新讀取再判斷：
 *   等鎖的期間狀態可能已經變了。一個系列最多一張待繳（部分唯一索引），所以要先刪舊的待繳、再產生新的。
 */
@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly transactions: TransactionsService,
  ) {}

  /**
   * GET /bills。status 篩選 pending、paid、overdue（待繳且到期日早於今天）；dueFrom、dueTo 篩選到期日（含頭尾）。
   * 排序：待繳在前，依到期日由近到遠；已繳在後，依到期日由新到舊；相同時再依 id。
   * 兩組方向不同，分兩次查再接起來（splitPage）。
   */
  async findAll(
    userId: string,
    query: BillListQueryDto,
  ): Promise<BillListResponseDto> {
    const today = this.clock.today();
    if (
      query.dueFrom !== undefined &&
      query.dueTo !== undefined &&
      query.dueFrom > query.dueTo
    ) {
      throw AppException.forField('VALIDATION_FAILED', 'dueFrom');
    }

    const dueDate: Prisma.DateTimeFilter = {
      ...(query.dueFrom === undefined ? {} : { gte: toDbDate(query.dueFrom) }),
      ...(query.dueTo === undefined ? {} : { lte: toDbDate(query.dueTo) }),
    };
    const pendingWhere: Prisma.BillWhereInput = {
      userId,
      status: BillStatus.pending,
      // overdue：再加上「早於今天」，和 dueTo 同時成立
      dueDate:
        query.status === BillListStatus.overdue
          ? { ...dueDate, lt: toDbDate(today) }
          : dueDate,
    };
    const paidWhere: Prisma.BillWhereInput = {
      userId,
      status: BillStatus.paid,
      dueDate,
    };
    const wantPending = query.status !== BillListStatus.paid;
    const wantPaid =
      query.status === undefined || query.status === BillListStatus.paid;

    const [pendingTotal, paidTotal] = await Promise.all([
      wantPending ? this.prisma.bill.count({ where: pendingWhere }) : 0,
      wantPaid ? this.prisma.bill.count({ where: paidWhere }) : 0,
    ]);
    const { first, second } = splitPage(
      query.page,
      query.pageSize,
      pendingTotal,
    );
    const [pending, paid] = await Promise.all([
      wantPending && first.take > 0
        ? this.prisma.bill.findMany({
            where: pendingWhere,
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            ...first,
          })
        : [],
      wantPaid && second.take > 0
        ? this.prisma.bill.findMany({
            where: paidWhere,
            orderBy: [{ dueDate: 'desc' }, { id: 'asc' }],
            ...second,
          })
        : [],
    ]);

    return {
      items: [...pending, ...paid].map((b) => toBillResponse(b, today)),
      page: query.page,
      pageSize: query.pageSize,
      total: pendingTotal + paidTotal,
    };
  }

  /** GET /bills/:id：已繳的也查得到 */
  async findOne(userId: string, id: string): Promise<BillResponseDto> {
    const today = this.clock.today();
    return toBillResponse(await this.findOwned(userId, id), today);
  }

  /**
   * POST /bills。建立的帳單一律是待繳，產生新的系列（series_id 由資料庫產生）。
   * 依序檢查：到期日不晚於今天加 50 年 → 帳戶屬於登入者且啟用中 → 分類可用且是支出分類（C 的 assertAccountAndCategoryOwned）。
   * dueDay、dueMonth 由到期日取；dueMonth 只有 yearly 有值。不需要鎖定：新系列沒有別的請求在用。
   */
  async create(userId: string, dto: CreateBillDto): Promise<BillResponseDto> {
    const today = this.clock.today();
    assertDueDateNotTooFar(dto.dueDate, today);
    await this.accounts.assertAccountAndCategoryOwned(
      userId,
      dto.accountId,
      dto.categoryId,
      { categoryType: CategoryType.expense },
    );

    const recurrence = dto.recurrence ?? Recurrence.none;
    const bill = await this.prisma.bill.create({
      data: {
        userId,
        name: dto.name,
        amount: toMoney(dto.amount),
        categoryId: dto.categoryId,
        accountId: dto.accountId,
        dueDate: toDbDate(dto.dueDate),
        dueDay: dueDayOf(dto.dueDate),
        dueMonth: dueMonthOf(dto.dueDate, recurrence),
        recurrence,
        note: dto.note ?? null,
      },
    });
    return toBillResponse(bill, today);
  }

  /**
   * PATCH /bills/:id。沒傳的欄位保持原值；note 傳 null 代表清空。
   * 「有變更」一律指值跟原值不同，不是請求有沒有帶（前端整份送出）：amount 用數值比較，日期比 YYYY-MM-DD。
   * - 已繳：只能改 name、note；其他欄位有變更 → 409 BILL_ALREADY_PAID。
   * - 待繳：帳戶、分類有變更才檢查（在鎖定系列的交易內）；到期日有變更時 dueDay 跟著改，
   *   並檢查晚於同系列最後一張已繳的到期日、不晚於今天加 50 年；到期日或週期有變更時重算 dueMonth。
   */
  async update(
    userId: string,
    id: string,
    dto: UpdateBillDto,
  ): Promise<BillResponseDto> {
    const today = this.clock.today();
    const { seriesId } = await this.findOwned(userId, id);

    const bill = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndReload(tx, seriesId, userId, id);
      const currentDueDate = fromDbDate(current.dueDate);
      // 合併後的值（沒傳的欄位是原值），再跟原值比
      const next = {
        amount: dto.amount === undefined ? current.amount : toMoney(dto.amount),
        categoryId: dto.categoryId ?? current.categoryId,
        accountId: dto.accountId ?? current.accountId,
        dueDate: dto.dueDate ?? currentDueDate,
        recurrence: dto.recurrence ?? current.recurrence,
      };
      const changed = {
        amount: !next.amount.equals(current.amount),
        categoryId: next.categoryId !== current.categoryId,
        accountId: next.accountId !== current.accountId,
        dueDate: next.dueDate !== currentDueDate,
        recurrence: next.recurrence !== current.recurrence,
      };

      if (current.status === BillStatus.paid) {
        if (Object.values(changed).some(Boolean)) {
          throw new AppException('BILL_ALREADY_PAID');
        }
        return tx.bill.update({
          where: { id: current.id },
          data: { name: dto.name, note: dto.note },
        });
      }

      await this.assertRefsUsable(tx, userId, next, changed);
      if (changed.dueDate) {
        assertDueDateNotTooFar(next.dueDate, today);
        await this.assertAfterLastPaid(tx, seriesId, next.dueDate);
      }

      return tx.bill.update({
        where: { id: current.id },
        data: {
          name: dto.name,
          amount: next.amount,
          categoryId: next.categoryId,
          accountId: next.accountId,
          recurrence: next.recurrence,
          // undefined：保持原值；null：清空
          note: dto.note,
          // 到期日的值沒變就不重算 dueDay：2/28 那期的 dueDay 是 31，只改備註時不能變成 28
          ...(changed.dueDate
            ? {
                dueDate: toDbDate(next.dueDate),
                dueDay: dueDayOf(next.dueDate),
              }
            : {}),
          ...(changed.dueDate || changed.recurrence
            ? { dueMonth: dueMonthOf(next.dueDate, next.recurrence) }
            : {}),
        },
      });
    });
    return toBillResponse(bill, today);
  }

  /**
   * DELETE /bills/:id：只能刪待繳的帳單，已繳 → 409 BILL_ALREADY_PAID（要先取消繳費）。
   * 待繳的就是系列最新一期，刪除後系列不再產生下一期，已繳的歷史保留；待繳的帳單沒有交易，不用處理。
   */
  async remove(userId: string, id: string): Promise<void> {
    const { seriesId } = await this.findOwned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndReload(tx, seriesId, userId, id);
      if (current.status === BillStatus.paid) {
        throw new AppException('BILL_ALREADY_PAID');
      }
      await tx.bill.delete({ where: { id: current.id } });
    });
  }

  /**
   * POST /bills/:id/pay。在同一個資料庫交易內：建立支出 → 帳單改為已繳 → 重複的帳單建立下一期。
   * - 已繳 → 409 BILL_ALREADY_PAID（鎖定後重新讀取，同時送兩次也只有一筆支出）。
   * - paidAmount 預設帳單的 amount；paidDate 預設台北今天，晚於今天 → 400 PAID_DATE_IN_FUTURE。
   * - 支出用 C 的 createBillTransaction：帳戶、分類沿用帳單，note 是帳單名稱（Q14）。扣款帳戶停用時它丟 409 ACCOUNT_INACTIVE；
   *   不檢查餘額（Q16）。不檢查分類：分類之後被停用也照常繳費（Q17）。
   */
  async pay(
    userId: string,
    id: string,
    dto: PayBillDto,
  ): Promise<PayBillResponseDto> {
    const today = this.clock.today();
    const { seriesId } = await this.findOwned(userId, id);

    const { bill, nextBill } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockAndReload(tx, seriesId, userId, id);
      if (current.status === BillStatus.paid) {
        throw new AppException('BILL_ALREADY_PAID');
      }
      const paidAmount =
        dto.paidAmount === undefined ? current.amount : toMoney(dto.paidAmount);
      const paidDate = dto.paidDate ?? today;
      if (paidDate > today) {
        throw AppException.forField('PAID_DATE_IN_FUTURE', 'paidDate');
      }

      await this.transactions.createBillTransaction(tx, userId, {
        billId: current.id,
        accountId: current.accountId,
        categoryId: current.categoryId,
        amount: paidAmount,
        transactionDate: paidDate,
        note: current.name,
      });
      const paid = await tx.bill.update({
        where: { id: current.id },
        data: {
          status: BillStatus.paid,
          paidAmount,
          paidDate: toDbDate(paidDate),
        },
      });
      const next =
        current.recurrence === Recurrence.none
          ? null
          : await tx.bill.create({ data: nextPeriodData(current) });
      return { bill: paid, nextBill: next };
    });

    this.logger.log(
      { billId: bill.id, seriesId, nextBillId: nextBill?.id ?? null },
      '帳單已繳費',
    );
    return {
      bill: toBillResponse(bill, today),
      nextBill: nextBill === null ? null : toBillResponse(nextBill, today),
    };
  }

  /**
   * POST /bills/:id/unpay。在同一個資料庫交易內：刪除同系列的待繳帳單 → 刪除這張的支出 → 這張改回待繳。
   * - 待繳 → 409 BILL_NOT_PAID；同系列有到期日更晚的已繳帳單 → 409 NEXT_BILL_ALREADY_PAID（要從最新一期往回取消）。
   * - 扣款帳戶停用：C 的 deleteBillTransaction 丟 409 ACCOUNT_INACTIVE（Q2）。這時待繳帳單已經刪了，但整個交易一起回滾。
   * - 系列已經停止（沒有待繳，或待繳是不重複）時，這張也改成不重複、dueMonth 改成 null（stopsOnUnpay）。
   * 順序：先刪待繳，才不會同時有兩張待繳；先刪支出，再把這張改回待繳。
   * 提交後寫 info 日誌：刪掉的待繳帳單不在路徑上，請求完成日誌看不出來。
   */
  async unpay(userId: string, id: string): Promise<BillResponseDto> {
    const today = this.clock.today();
    const { seriesId } = await this.findOwned(userId, id);

    const { bill, deletedPendingId, stoppedRecurrence } =
      await this.prisma.$transaction(async (tx) => {
        const current = await this.lockAndReload(tx, seriesId, userId, id);
        if (current.status === BillStatus.pending) {
          throw new AppException('BILL_NOT_PAID');
        }
        const laterPaid = await tx.bill.findFirst({
          where: {
            userId,
            seriesId,
            status: BillStatus.paid,
            dueDate: { gt: current.dueDate },
          },
          select: { id: true },
        });
        if (laterPaid) throw new AppException('NEXT_BILL_ALREADY_PAID');

        // 要在刪除之前看：刪掉之後就看不出系列有沒有停止
        const pending = await this.findPending(tx, userId, seriesId);
        const stop = stopsOnUnpay(pending);
        if (pending) await tx.bill.delete({ where: { id: pending.id } });
        await this.transactions.deleteBillTransaction(tx, userId, current.id);
        const unpaid = await tx.bill.update({
          where: { id: current.id },
          data: {
            status: BillStatus.pending,
            paidAmount: null,
            paidDate: null,
            ...(stop ? { recurrence: Recurrence.none, dueMonth: null } : {}),
          },
        });
        return {
          bill: unpaid,
          deletedPendingId: pending?.id ?? null,
          stoppedRecurrence: stop,
        };
      });

    this.logger.log(
      { billId: bill.id, seriesId, deletedPendingId, stoppedRecurrence },
      '帳單已取消繳費',
    );
    return toBillResponse(bill, today);
  }

  /**
   * POST /bills/:id/stop-recurrence。從系列的任何一張進來都可以，處理的是同系列的待繳帳單（最多一張）：
   * keepCurrent 是 true 時改成不重複（dueMonth 改成 null），false 時刪除。已繳的歷史都不動。
   * 系列沒有待繳帳單 → 什麼都不做，回 stopped: false。
   * 有處理時提交後寫 info 日誌：被處理的待繳帳單不一定是路徑上那張，keepCurrent 在 body 裡，請求完成日誌都看不到。
   */
  async stopRecurrence(
    userId: string,
    id: string,
    dto: StopRecurrenceDto,
  ): Promise<StopRecurrenceResponseDto> {
    const today = this.clock.today();
    const { seriesId } = await this.findOwned(userId, id);

    const { pendingId, kept } = await this.prisma.$transaction(async (tx) => {
      await this.lockAndReload(tx, seriesId, userId, id);
      const pending = await this.findPending(tx, userId, seriesId);
      if (!pending) return { pendingId: null, kept: null };

      if (!dto.keepCurrent) {
        await tx.bill.delete({ where: { id: pending.id } });
        return { pendingId: pending.id, kept: null };
      }
      const updated = await tx.bill.update({
        where: { id: pending.id },
        data: { recurrence: Recurrence.none, dueMonth: null },
      });
      return { pendingId: pending.id, kept: updated };
    });
    if (pendingId === null) return { stopped: false, bill: null };

    this.logger.log(
      { billId: id, seriesId, pendingId, keepCurrent: dto.keepCurrent },
      '帳單已停止重複',
    );
    return {
      stopped: true,
      bill: kept === null ? null : toBillResponse(kept, today),
    };
  }

  /**
   * Dashboard 的帳單區塊（BILL-9，規則見 bill-alerts.types.ts）。today 由呼叫端用 ClockService 取得，這裡不取時間。
   * 只讀這位使用者待繳、到期日不晚於今天＋14 天的帳單（逾期的不論多久都算）；計算在 summarizeBillAlerts。
   * 不呼叫 C 的 service；資金缺口由 C 用 dueTotal 計算（Q3）。
   */
  async getBillAlerts(userId: string, today: DateOnly): Promise<BillAlerts> {
    const rows = await this.prisma.bill.findMany({
      where: {
        userId,
        status: BillStatus.pending,
        dueDate: { lte: toDbDate(addDays(today, DUE_SOON_DAYS)) },
      },
      select: {
        id: true,
        name: true,
        amount: true,
        dueDate: true,
        accountId: true,
      },
    });
    return summarizeBillAlerts(
      rows.map((r) => ({ ...r, dueDate: fromDbDate(r.dueDate) })),
      today,
    );
  }

  private async findOwned(userId: string, id: string): Promise<Bill> {
    const bill = await this.prisma.bill.findFirst({ where: { id, userId } });
    if (!bill) throw new AppException('BILL_NOT_FOUND');
    return bill;
  }

  /**
   * 鎖定整個系列，再重新讀取這張帳單。等鎖的期間被別的請求刪掉 → 404 BILL_NOT_FOUND。
   * FOR UPDATE 是資料列鎖，交易結束就放開，可以用在 Supabase 的 transaction 模式連線池。
   */
  private async lockAndReload(
    tx: PrismaTx,
    seriesId: string,
    userId: string,
    id: string,
  ): Promise<Bill> {
    await tx.$queryRaw`SELECT id FROM bills WHERE series_id = ${seriesId}::uuid FOR UPDATE`;
    const bill = await tx.bill.findFirst({ where: { id, userId } });
    if (!bill) throw new AppException('BILL_NOT_FOUND');
    return bill;
  }

  /** 同系列的待繳帳單；一個系列最多一張（部分唯一索引 bills_one_pending_per_series） */
  private findPending(
    tx: PrismaTx,
    userId: string,
    seriesId: string,
  ): Promise<Bill | null> {
    return tx.bill.findFirst({
      where: { userId, seriesId, status: BillStatus.pending },
    });
  }

  /**
   * 修改待繳帳單時，帳戶、分類有變更才檢查（帳戶之後被停用，只改備註不該失敗）。
   * 兩個都變用 assertAccountAndCategoryOwned；只有帳戶變只查帳戶；只有分類變只查分類。
   */
  private async assertRefsUsable(
    tx: PrismaTx,
    userId: string,
    next: { accountId: string; categoryId: string },
    changed: { accountId: boolean; categoryId: boolean },
  ): Promise<void> {
    if (changed.accountId && changed.categoryId) {
      await this.accounts.assertAccountAndCategoryOwned(
        userId,
        next.accountId,
        next.categoryId,
        { categoryType: CategoryType.expense },
        tx,
      );
    } else if (changed.accountId) {
      await this.accounts.assertActiveAccount(
        userId,
        next.accountId,
        'accountId',
        tx,
      );
    } else if (changed.categoryId) {
      await this.categories.assertUsable(
        userId,
        next.categoryId,
        CategoryType.expense,
        'categoryId',
        tx,
      );
    }
  }

  /** 待繳帳單的到期日必須晚於同系列最後一張已繳的到期日，否則下一期會排在已繳的那期之前 */
  private async assertAfterLastPaid(
    tx: PrismaTx,
    seriesId: string,
    dueDate: DateOnly,
  ): Promise<void> {
    const lastPaid = await tx.bill.findFirst({
      where: { seriesId, status: BillStatus.paid },
      orderBy: { dueDate: 'desc' },
      select: { dueDate: true },
    });
    if (lastPaid && dueDate <= fromDbDate(lastPaid.dueDate)) {
      throw AppException.forField('VALIDATION_FAILED', 'dueDate');
    }
  }
}
