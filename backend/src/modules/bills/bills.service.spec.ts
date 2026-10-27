import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BillsModule } from './bills.module.js';
import { BillsService } from './bills.service.js';

describe('BillsService（BILL-1 空殼）', () => {
  it('BillsModule 匯出 BillsService，其他模組 import 後拿得到', async () => {
    // 測試模組自己的 provider 注入 BillsService：沒有 export 時 compile 會失敗
    const moduleRef = await Test.createTestingModule({
      imports: [BillsModule],
      providers: [
        {
          provide: 'DASHBOARD',
          useFactory: (bills: BillsService) => bills,
          inject: [BillsService],
        },
      ],
    }).compile();
    expect(moduleRef.get('DASHBOARD')).toBeInstanceOf(BillsService);
  });

  it('getBillAlerts 在 BILL-9 實作前丟 NotImplementedException', () => {
    expect(() =>
      new BillsService().getBillAlerts('user-id', '2026-10-27'),
    ).toThrow(NotImplementedException);
  });
});
