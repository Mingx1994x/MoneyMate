import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CategoryListQueryDto } from './category-list-query.dto.js';

// INF-4 之前沒有全域 ValidationPipe，用 plainToInstance 加 validate() 驗
async function invalidFields(
  plain: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(CategoryListQueryDto, plain));
  return errors.map((e) => e.property);
}

describe('CategoryListQueryDto', () => {
  it('不帶 type 通過', async () => {
    expect(await invalidFields({})).toEqual([]);
  });

  it.each(['income', 'expense'])('type = %s 通過', async (type) => {
    expect(await invalidFields({ type })).toEqual([]);
  });

  it.each(['', 'transfer', 'Income', 'food'])(
    'type = %j 失敗（空字串不會被當成沒帶）',
    async (type) => {
      expect(await invalidFields({ type })).toEqual(['type']);
    },
  );
});
