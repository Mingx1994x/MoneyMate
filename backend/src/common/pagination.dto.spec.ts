import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination.dto.js';

async function check(plain: Record<string, unknown>) {
  const dto = plainToInstance(PaginationQueryDto, plain);
  const errors = await validate(dto);
  return { dto, fields: errors.map((e) => e.property) };
}

describe('PaginationQueryDto', () => {
  it('沒帶參數時 page=1、pageSize=20', async () => {
    const { dto, fields } = await check({});
    expect(dto).toMatchObject({ page: 1, pageSize: 20 });
    expect(fields).toEqual([]);
  });

  it('query 字串轉成數字', async () => {
    const { dto, fields } = await check({ page: '3', pageSize: '100' });
    expect(dto).toMatchObject({ page: 3, pageSize: 100 });
    expect(fields).toEqual([]);
  });

  it.each([
    [{ page: '0' }, 'page'],
    [{ page: '1.5' }, 'page'],
    [{ page: '' }, 'page'],
    [{ page: 'abc' }, 'page'],
    [{ pageSize: '101' }, 'pageSize'],
    [{ pageSize: '0' }, 'pageSize'],
  ])('%j 失敗', async (plain, field) => {
    expect((await check(plain)).fields).toEqual([field]);
  });
});
