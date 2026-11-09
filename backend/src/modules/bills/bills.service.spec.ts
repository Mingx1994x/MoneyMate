import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClockModule } from '../../clock/clock.module.js';
import { PrismaModule, PrismaService } from '../../prisma/index.js';
import { FakeClock } from '../../../test/utils/fake-clock.js';
import type { AccountsService } from '../accounts/index.js';
import type { CategoriesService } from '../categories/index.js';
// 從 index 匯入，確認 C 用的入口匯出了模組與 service
import { BillsModule, BillsService } from './index.js';

// CRUD 與列表在 test/bills.e2e-spec.ts 連真的資料庫測；這裡只測模組的匯出
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

  it('getBillAlerts 在 BILL-9 實作前丟 NotImplementedException', () => {
    const service = new BillsService(
      {} as PrismaService,
      FakeClock.onTaipeiDate('2026-10-28'),
      {} as AccountsService,
      {} as CategoriesService,
    );
    expect(() => service.getBillAlerts('user-id', '2026-10-27')).toThrow(
      NotImplementedException,
    );
  });
});
