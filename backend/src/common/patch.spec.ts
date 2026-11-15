import { plainToInstance } from 'class-transformer';
import { definedOnly, mergePatch } from './patch.js';

interface State {
  name: string;
  amount: string;
  note: string | null;
}

// 模擬 plainToInstance 產生的 DTO：宣告過的欄位沒傳也是自有屬性（值為 undefined）
class PatchDto {
  name?: string;
  amount?: string;
  note?: string | null;
}

describe('definedOnly', () => {
  it('去掉 undefined，保留 null、0、空字串、false', () => {
    expect(
      definedOnly({ a: undefined, b: null, c: 0, d: '', e: false }),
    ).toEqual({ b: null, c: 0, d: '', e: false });
    expect(Object.keys(definedOnly({ a: undefined }))).toEqual([]);
  });
});

describe('mergePatch', () => {
  const current: State = { name: '房貸', amount: '100.00', note: '舊備註' };

  it('沒傳的欄位（DTO 上值是 undefined 的自有屬性）保留原值', () => {
    const dto = plainToInstance(PatchDto, { amount: '200.00' });
    expect(Object.keys(dto)).toContain('name');
    expect(mergePatch(current, dto)).toEqual({
      name: '房貸',
      amount: '200.00',
      note: '舊備註',
    });
  });

  it('傳 null 代表清空', () => {
    expect(mergePatch(current, { note: null })).toEqual({
      ...current,
      note: null,
    });
  });

  it('不改動 current', () => {
    mergePatch(current, { name: '車貸' });
    expect(current.name).toBe('房貸');
  });
});
