import { Injectable } from '@nestjs/common';
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
import { DUE_SOON_DAYS, summarizeBillAlerts } from './bill-alerts.js';
import type { BillAlerts } from './bill-alerts.types.js';
import { toBillResponse } from './bill-mapper.js';
import {
  assertDueDateNotTooFar,
  dueDayOf,
  dueMonthOf,
  splitPage,
} from './bill-rules.js';
import type { BillListQueryDto } from './dto/bill-list-query.dto.js';
import { BillListStatus } from './dto/bill-list-status.enum.js';
import type {
  BillListResponseDto,
  BillResponseDto,
} from './dto/bill-response.dto.js';
import type { CreateBillDto } from './dto/create-bill.dto.js';
import type { UpdateBillDto } from './dto/update-bill.dto.js';

/**
 * 帳單：CRUD（BILL-2）、列表（BILL-3）。繳費、取消繳費、停止重複在 BILL-5～7 加入。
 * - 端點方法開頭從 ClockService 取一次今天，往下傳。
 * - 查詢一律帶 userId；不存在、屬於他人一律 404 BILL_NOT_FOUND。
 * - 修改、刪除先鎖定整個系列（FOR UPDATE），鎖定後重新讀取再判斷：等鎖的期間狀態可能已經變了。
 */
@Injectable()
export class BillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
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
