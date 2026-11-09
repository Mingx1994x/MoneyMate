import { Test } from '@nestjs/testing';
import { ClockModule } from '../../clock/clock.module.js';
import { toDbDate } from '../../common/date-only.js';
import { Prisma, PrismaModule, PrismaService } from '../../prisma/index.js';
import { FakeClock } from '../../../test/utils/fake-clock.js';
import type { AccountsService } from '../accounts/index.js';
import type { CategoriesService } from '../categories/index.js';
// 從 index 匯入，確認 C 用的入口匯出了模組與 service
import { BillsModule, BillsService } from './index.js';

// 端點在 test/bills.e2e-spec.ts 連真的資料庫測；這裡測模組的匯出與 getBillAlerts 的查詢條件
describe('BillsService', () => {
  it('BillsModule 匯出 BillsService，其他模組 import 後拿得到', async () => {
    // 測試模組自己的 provider 注入 BillsService：沒有 export 時 compile 會失敗
    const moduleRef = await Test.createTestingModule({
      // 正式環境的 ClockModule、PrismaModule 是全域的（AppModule 匯入），BillsService 注入要用到；
      // PrismaService 換成空物件，這個測試不連資料庫
      imports: [BillsModule, ClockModule, PrismaModule],
      providers: [
        {
          provide: 'DASHBOARD',
          useFactory: (bills: BillsService) => bills,
          inject: [BillsService],
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    expect(moduleRef.get('DASHBOARD')).toBeInstanceOf(BillsService);
  });

  describe('getBillAlerts', () => {
    it('只查這位使用者待繳、到期日不晚於今天＋14 天的帳單，到期日轉成 YYYY-MM-DD 再計算', async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: '房租',
          amount: new Prisma.Decimal('15000.00'),
          dueDate: toDbDate('2026-11-01'),
          accountId: '00000000-0000-4000-8000-0000000000aa',
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: '手機費',
          amount: new Prisma.Decimal('999.00'),
          dueDate: toDbDate('2026-10-25'),
          accountId: '00000000-0000-4000-8000-0000000000aa',
        },
      ]);
      const prisma = { bill: { findMany } } as unknown as PrismaService;

      const a = await new BillsService(
        prisma,
        FakeClock.onTaipeiDate('2026-10-28'),
        {} as AccountsService,
        {} as CategoriesService,
      ).getBillAlerts('user-id', '2026-10-28');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: 'user-id',
            status: 'pending',
            dueDate: { lte: toDbDate('2026-11-11') },
          },
        }),
      );
      expect(a.overdue).toMatchObject([
        { name: '手機費', dueDate: '2026-10-25', daysUntilDue: -3 },
      ]);
      expect(a.dueSoon).toMatchObject([
        { name: '房租', dueDate: '2026-11-01', daysUntilDue: 4 },
      ]);
      expect(a.dueTotal.toFixed(2)).toBe('15000.00');
    });
  });
});
