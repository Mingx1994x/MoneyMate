import { NotImplementedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoansModule } from './loans.module.js';
import { LoansService } from './loans.service.js';

describe('LoansService（LOAN-1 空殼）', () => {
  it('LoansModule 匯出 LoansService，其他模組 import 後拿得到', async () => {
    // 測試模組自己的 provider 注入 LoansService：沒有 export 時 compile 會失敗
    const moduleRef = await Test.createTestingModule({
      imports: [LoansModule],
      providers: [
        {
          provide: 'DASHBOARD',
          useFactory: (loans: LoansService) => loans,
          inject: [LoansService],
        },
      ],
    }).compile();
    expect(moduleRef.get('DASHBOARD')).toBeInstanceOf(LoansService);
  });

  it('getLoanSummary 在 LOAN-5 實作前丟 NotImplementedException', () => {
    expect(() =>
      new LoansService().getLoanSummary('user-id', '2026-10-27'),
    ).toThrow(NotImplementedException);
  });
});
