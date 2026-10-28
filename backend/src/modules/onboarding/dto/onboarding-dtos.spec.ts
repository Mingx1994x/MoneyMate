import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateOnboardingDto } from './create-onboarding.dto.js';

// INF-4 之前沒有全域 ValidationPipe，用 plainToInstance 加 validate() 驗
async function invalidFields(
  cls: new () => object,
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('CreateOnboardingDto', () => {
  it('每月花費的上下限都通過；現有資產可以省略、null、0、1 億', async () => {
    for (const plain of [
      { monthlySpending: 1000 },
      { monthlySpending: 333000, currentAssets: null },
      { monthlySpending: 40000, currentAssets: 0 },
      { monthlySpending: 40000, currentAssets: 100000000 },
    ]) {
      expect(await invalidFields(CreateOnboardingDto, plain)).toEqual([]);
    }
  });

  it.each([undefined, null, 999, 333001, 40000.5, '40000'])(
    'monthlySpending=%j 失敗',
    async (monthlySpending) => {
      expect(
        await invalidFields(CreateOnboardingDto, { monthlySpending }),
      ).toEqual(['monthlySpending']);
    },
  );

  it.each([-1, 100000001, 1.5, '800000'])(
    'currentAssets=%j 失敗',
    async (currentAssets) => {
      expect(
        await invalidFields(CreateOnboardingDto, {
          monthlySpending: 40000,
          currentAssets,
        }),
      ).toEqual(['currentAssets']);
    },
  );
});
