import { Test } from '@nestjs/testing';
import { toDbDate } from '../../common/date-only.js';
import { Prisma, PrismaModule, PrismaService } from '../../prisma/index.js';
// 從 index 匯入，確認 C 用的入口匯出了模組與 service
import { LoansModule, LoansService } from './index.js';

describe('LoansService', () => {
  it('LoansModule 匯出 LoansService，其他模組 import 後拿得到', async () => {
    // 測試模組自己的 provider 注入 LoansService：沒有 export 時 compile 會失敗
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, LoansModule],
      providers: [
        {
          provide: 'DASHBOARD',
          useFactory: (loans: LoansService) => loans,
          inject: [LoansService],
        },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    expect(moduleRef.get('DASHBOARD')).toBeInstanceOf(LoansService);
  });

  describe('getLoanSummary', () => {
    it('只查這位使用者 active 的貸款，結清日轉成 YYYY-MM-DD 再計算', async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: '車貸',
          outstandingBalance: new Prisma.Decimal('320000.00'),
          monthlyPayment: new Prisma.Decimal('8500.00'),
          paymentDay: 5,
          endDate: toDbDate('2026-11-05'),
        },
      ]);
      const prisma = { loan: { findMany } } as unknown as PrismaService;

      const s = await new LoansService(prisma).getLoanSummary(
        'user-id',
        '2026-10-28',
      );

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-id', status: 'active' },
        }),
      );
      expect(s.activeCount).toBe(1);
      expect(s.outstandingTotal.toFixed(2)).toBe('320000.00');
      expect(s.upcomingPayments).toMatchObject([
        { date: '2026-11-05', daysUntilDue: 8 },
      ]);
    });
  });
});
