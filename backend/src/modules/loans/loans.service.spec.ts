import { Test } from '@nestjs/testing';
import { ClockModule } from '../../clock/clock.module.js';
import { toDbDate } from '../../common/date-only.js';
import { AppException } from '../../common/errors/app.exception.js';
import { Prisma, PrismaModule, PrismaService } from '../../prisma/index.js';
import { FakeClock } from '../../../test/utils/fake-clock.js';
// 從 index 匯入，確認 C 用的入口匯出了模組與 service
import { LoansModule, LoansService } from './index.js';

// 這裡不連資料庫（getLoanSummary 用假的 prisma）；CRUD 在 test/loans.e2e-spec.ts 連真的資料庫測
const newService = () =>
  new LoansService({} as PrismaService, FakeClock.onTaipeiDate('2026-10-28'));

describe('LoansService', () => {
  it('LoansModule 匯出 LoansService，其他模組 import 後拿得到', async () => {
    // 測試模組自己的 provider 注入 LoansService：沒有 export 時 compile 會失敗
    const moduleRef = await Test.createTestingModule({
      // 正式環境的 ClockModule、PrismaModule 是全域的（AppModule 匯入），LoansService 注入要用到；
      // PrismaService 換成空物件，這個測試不連資料庫
      imports: [LoansModule, ClockModule, PrismaModule],
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

      const s = await new LoansService(
        prisma,
        FakeClock.onTaipeiDate('2026-10-28'),
      ).getLoanSummary('user-id', '2026-10-28');

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

  describe('paymentPreview（LOAN-4）', () => {
    const service = newService();
    const TODAY = '2026-10-28';
    const query = {
      outstandingBalance: '1000000.00',
      interestRate: 3,
      paymentDay: 31,
      endDate: '2031-09-30',
    };

    it('PRD 15.8 驗算案例：金額回 2 位小數的字串', () => {
      expect(service.paymentPreview(query, TODAY)).toEqual({
        monthlyPayment: '17969.00',
        totalInterest: '78120.00',
        installments: 60,
      });
    });

    it('結清日早於今天：期數視為 1，不報錯', () => {
      expect(
        service.paymentPreview({ ...query, endDate: '2026-09-30' }, TODAY),
      ).toEqual({
        monthlyPayment: '1002500.00',
        totalInterest: '2500.00',
        installments: 1,
      });
    });

    it('結清日剛好是今天加 50 年可以試算（Q12）', () => {
      expect(
        service.paymentPreview({ ...query, endDate: '2076-10-28' }, TODAY)
          .installments,
      ).toBe(600);
    });

    it('結清日晚於今天加 50 年回 VALIDATION_FAILED（endDate）', () => {
      const call = () =>
        service.paymentPreview({ ...query, endDate: '2076-10-29' }, TODAY);
      expect(call).toThrow(AppException);
      expect(call).toThrow(
        expect.objectContaining({
          code: 'VALIDATION_FAILED',
          opts: expect.objectContaining({
            details: [expect.objectContaining({ field: 'endDate' })],
          }) as unknown,
        }),
      );
    });
  });
});
