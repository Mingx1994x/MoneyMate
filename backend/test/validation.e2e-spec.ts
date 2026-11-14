import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp } from './utils/create-test-app.js';
import { ValidationTestController } from './utils/validation-test.controller.js';

const BASE = '/api/v1/__validation-test';
const ACCOUNT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const LOAN_ID = '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10';

const VALID = {
  name: '房貸',
  amount: '1234.50',
  accountId: ACCOUNT_ID,
  date: '2026-10-28',
};

interface Detail {
  field: string;
  code: string;
}

interface ErrorBody {
  code: string;
  details: Detail[];
}

/** res.body 是 any，取錯誤回應時先標上型別 */
function err(res: { body: unknown }): ErrorBody {
  return res.body as ErrorBody;
}

describe('驗證管線（e2e）', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ValidationTestController] });
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(body: unknown) {
    return request(app.getHttpServer())
      .post(BASE)
      .send(body as object);
  }

  function codeOf(details: Detail[], field: string): string | undefined {
    return details.find((d) => d.field === field)?.code;
  }

  describe('body', () => {
    it('合法的 body：通過，@Trim、@EmptyToNull 生效', async () => {
      const res = await post({ ...VALID, name: '  房貸 ', note: '' }).expect(
        201,
      );
      expect(res.body).toMatchObject({ name: '房貸', note: null });
    });

    it('金額送 JSON 數字回 400 AMOUNT_INVALID（不開 enableImplicitConversion）', async () => {
      const res = await post({ ...VALID, amount: 1234.5 }).expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'AMOUNT_INVALID',
        message: '金額格式不正確',
        details: [
          {
            field: 'amount',
            code: 'AMOUNT_INVALID',
            message: '金額格式不正確',
          },
        ],
      });
    });

    it.each([
      ['0', 'AMOUNT_NOT_POSITIVE'],
      ['-1', 'AMOUNT_NOT_POSITIVE'],
      ['', 'AMOUNT_INVALID'],
      ['abc', 'AMOUNT_INVALID'],
    ])('金額 %j 回 %s（AC-05）', async (amount, code) => {
      const res = await post({ ...VALID, amount }).expect(400);
      expect(res.body).toMatchObject({ code, details: [{ field: 'amount' }] });
    });

    it('缺少金額回 AMOUNT_INVALID', async () => {
      const { amount: _amount, ...rest } = VALID;
      const res = await post(rest).expect(400);
      expect(err(res).code).toBe('AMOUNT_INVALID');
    });

    it('accountId 不是 UUID 回 400 ACCOUNT_NOT_FOUND', async () => {
      const res = await post({ ...VALID, accountId: 'x' }).expect(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        code: 'ACCOUNT_NOT_FOUND',
        details: [{ field: 'accountId', code: 'ACCOUNT_NOT_FOUND' }],
      });
    });

    it('名稱只有空白回 NAME_INVALID', async () => {
      const res = await post({ ...VALID, name: '   ' }).expect(400);
      expect(err(res).code).toBe('NAME_INVALID');
    });

    it('多個欄位同時錯：每個欄位一筆，頂層代碼等於第一筆，回應不含送出的值', async () => {
      const res = await post({
        name: 1,
        amount: '__SENT_AMOUNT__',
        accountId: '__SENT_ID__',
        date: '__SENT_DATE__',
      }).expect(400);
      const details = err(res).details;
      expect(details.map((d) => d.field).sort()).toEqual(
        ['accountId', 'amount', 'date', 'name'].sort(),
      );
      expect(codeOf(details, 'name')).toBe('NAME_INVALID');
      expect(codeOf(details, 'amount')).toBe('AMOUNT_INVALID');
      expect(codeOf(details, 'accountId')).toBe('ACCOUNT_NOT_FOUND');
      expect(codeOf(details, 'date')).toBe('VALIDATION_FAILED');
      expect(err(res).code).toBe(details[0].code);
      // filter 用代碼表重組 details，送出的值不會出現在回應裡
      expect(res.text).not.toContain('__SENT_');
    });

    it('巢狀陣列：field 是屬性路徑，未宣告的巢狀欄位也擋下', async () => {
      const res = await post({
        ...VALID,
        items: [{ amount: '1' }, { amount: '-1', extra: 1 }],
      }).expect(400);
      const details = err(res).details;
      expect(codeOf(details, 'items.1.amount')).toBe('AMOUNT_NOT_POSITIVE');
      expect(codeOf(details, 'items.1.extra')).toBe('VALIDATION_FAILED');
    });

    it('陣列本身與元素同時出錯時兩者都報', async () => {
      const res = await post({
        ...VALID,
        items: [{ amount: '1' }, { amount: '1' }, { amount: 'x' }],
      }).expect(400);
      const details = err(res).details;
      expect(codeOf(details, 'items')).toBe('VALIDATION_FAILED');
      expect(codeOf(details, 'items.2.amount')).toBe('AMOUNT_INVALID');
    });

    it('陣列元素不是物件：items.0 回 VALIDATION_FAILED', async () => {
      const res = await post({ ...VALID, items: [1, null] }).expect(400);
      const details = err(res).details;
      expect(codeOf(details, 'items.0')).toBe('VALIDATION_FAILED');
      expect(codeOf(details, 'items.1')).toBe('VALIDATION_FAILED');
    });
  });

  describe('請求形狀的邊界', () => {
    it('未宣告的欄位回 400 VALIDATION_FAILED', async () => {
      const res = await post({ ...VALID, foo: 1 }).expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'foo', code: 'VALIDATION_FAILED' }],
      });
    });

    it('大量未宣告的欄位：details 最多 20 筆', async () => {
      const body: Record<string, unknown> = { ...VALID };
      for (let i = 0; i < 30; i++) body[`k${i}`] = 0;
      const res = await post(body).expect(400);
      expect(err(res).details).toHaveLength(20);
    });

    it('JSON body 是陣列：400，第一筆是 field 0', async () => {
      const res = await post([1, 2]).expect(400);
      expect(err(res).details[0]).toMatchObject({
        field: '0',
        code: 'VALIDATION_FAILED',
      });
    });

    it.each(['null', '"abc"'])(
      'JSON body 是 %s：body-parser 擋下，400 BAD_REQUEST',
      async (raw) => {
        const res = await request(app.getHttpServer())
          .post(BASE)
          .set('Content-Type', 'application/json')
          .send(raw)
          .expect(400);
        expect(res.body).toMatchObject({ code: 'BAD_REQUEST', details: [] });
      },
    );

    it.each([
      ['沒有 body', undefined],
      ['text/plain', 'name=a'],
    ])('%s：當成 {}，報各必填欄位', async (_label, raw) => {
      let req = request(app.getHttpServer()).post(BASE);
      if (raw !== undefined)
        req = req.set('Content-Type', 'text/plain').send(raw);
      const res = await req.expect(400);
      expect(codeOf(err(res).details, 'amount')).toBe('AMOUNT_INVALID');
    });

    it.each(['__proto__', 'constructor'])(
      'body 帶 %s：略過，不報錯也不會出現在 DTO',
      async (key) => {
        const raw = `{"name":"房貸","amount":"1","accountId":"${ACCOUNT_ID}","date":"2026-10-28","${key}":{"polluted":1}}`;
        const res = await request(app.getHttpServer())
          .post(BASE)
          .set('Content-Type', 'application/json')
          .send(raw)
          .expect(201);
        expect(res.text).not.toContain('polluted');
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      },
    );

    it('handler 沒有 query DTO：未宣告的 query 不檢查', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/no-dto?foo=1`)
        .expect(200);
    });

    // 靠的是 Nest 解析參數時的 microtask 順序，不是 Nest 保證的行為；升級時這裡會發現
    it('路徑 ID 不合法又帶不合法的 body：路徑的 404 優先', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/not-a-uuid`)
        .send({ name: '' })
        .expect(404);
      expect(err(res).code).toBe('LOAN_NOT_FOUND');
    });
  });

  describe('query', () => {
    it('轉換生效：page 是 number、includeInactive 是 boolean', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}?page=2&includeInactive=false`)
        .expect(200);
      expect(res.body).toEqual({
        page: 2,
        pageSize: 20,
        includeInactive: false,
      });
    });

    it('沒帶分頁參數：用預設值', async () => {
      const res = await request(app.getHttpServer()).get(BASE).expect(200);
      expect(res.body).toEqual({ page: 1, pageSize: 20 });
    });

    it.each([
      ['page=', 'page'],
      ['pageSize=101', 'pageSize'],
      ['includeInactive=1', 'includeInactive'],
      ['page=1&page=2', 'page'],
      ['foo=1', 'foo'],
      ['page[x]=1', 'page[x]'],
    ])('?%s 回 400 VALIDATION_FAILED（field: %s）', async (qs, field) => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}?${qs}`)
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field, code: 'VALIDATION_FAILED' }],
      });
    });
  });

  describe('PATCH', () => {
    function patch(body: object) {
      return request(app.getHttpServer())
        .patch(`${BASE}/${LOAN_ID}`)
        .send(body);
    }

    it('空的 PATCH 通過', async () => {
      await patch({}).expect(200);
    });

    it('不可為空的欄位傳 null：回該欄位的代碼', async () => {
      const res = await patch({ name: null }).expect(400);
      expect(err(res).code).toBe('NAME_INVALID');
      const res2 = await patch({ amount: null }).expect(400);
      expect(err(res2).code).toBe('AMOUNT_INVALID');
    });

    it('可為空的欄位傳 null：通過', async () => {
      const res = await patch({ note: null }).expect(200);
      expect(res.body).toEqual({ note: null });
    });

    // 記錄陷阱：Create DTO 的初始值會被 PartialType 繼承，沒傳也會帶上，所以 body DTO 不可以寫初始值
    it('PartialType 會繼承 Create DTO 的屬性初始值', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/initializer`)
        .send({ name: '房貸' })
        .expect(200);
      expect(res.body).toEqual({ status: 'active', name: '房貸' });
    });
  });
});
