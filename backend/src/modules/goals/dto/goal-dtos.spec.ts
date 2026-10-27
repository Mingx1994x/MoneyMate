import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateGoalDto } from './update-goal.dto.js';

// INF-4 之前沒有全域 ValidationPipe，用 plainToInstance 加 validate() 驗
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('UpdateGoalDto', () => {
  it('空的 body 通過（沒傳的欄位保持原值）', async () => {
    expect(await invalidFields(UpdateGoalDto, {})).toEqual([]);
  });

  it('birthYear、estMonthlySaving 可以傳 null 清空；儲蓄可為 0 或負數', async () => {
    for (const plain of [
      { birthYear: null, estMonthlySaving: null },
      { birthYear: 1900, estMonthlySaving: '0' },
      { birthYear: 1990, estMonthlySaving: '-5000.50' },
    ]) {
      expect(await invalidFields(UpdateGoalDto, plain)).toEqual([]);
    }
  });

  it('monthlySpending 傳 null 失敗（不可清空）', async () => {
    expect(
      await invalidFields(UpdateGoalDto, { monthlySpending: null }),
    ).toEqual(['monthlySpending']);
  });

  it.each([
    ['monthlySpending', 999],
    ['monthlySpending', 40000.5],
    ['birthYear', 1899],
    ['birthYear', 1990.5],
    ['estMonthlySaving', 15000],
    ['estMonthlySaving', '1.234'],
  ])('%s=%j 失敗', async (field, value) => {
    expect(await invalidFields(UpdateGoalDto, { [field]: value })).toEqual([
      field,
    ]);
  });
});
