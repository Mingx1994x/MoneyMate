import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DashboardSummaryQueryDto } from './dashboard-query.dto.js';

// INF-4 之前沒有全域 ValidationPipe，用 plainToInstance 加 validate() 驗
async function invalidFields(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(
    plainToInstance(DashboardSummaryQueryDto, plain),
  );
  return errors.map((e) => e.property);
}

describe('DashboardSummaryQueryDto', () => {
  it('不帶 month 通過；合法月份通過', async () => {
    expect(await invalidFields({})).toEqual([]);
    expect(await invalidFields({ month: '2026-10' })).toEqual([]);
  });

  it.each(['', '2026-13', '2026-1', '202610', '2026-10-01'])(
    'month = %j 失敗',
    async (month) => {
      expect(await invalidFields({ month })).toEqual(['month']);
    },
  );
});
