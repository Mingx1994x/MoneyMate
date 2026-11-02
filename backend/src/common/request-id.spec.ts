import type { Request, Response } from 'express';
import {
  assignRequestId,
  REQUEST_ID_PATTERN,
  resolveRequestId,
} from './request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each([
    undefined,
    '',
    ' ',
    [] as string[],
    ['abc'],
    'A-b_no',
    'a/b',
    'a'.repeat(65),
    'ab\n',
    'a,b',
  ])('%j 重產，且符合格式', (header) => {
    const id = resolveRequestId(header);
    expect(id).toMatch(UUID);
    expect(id).toMatch(REQUEST_ID_PATTERN);
    expect(id).not.toBe(header);
  });

  it.each([
    'abc',
    'abc-123',
    'A1b2',
    '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10',
    'x'.repeat(64),
  ])('%j 原樣沿用', (header) => {
    expect(resolveRequestId(header)).toBe(header);
  });

  it('同一個合法字串兩次結果相同', () => {
    expect(resolveRequestId('client-id-1')).toBe('client-id-1');
    expect(resolveRequestId('client-id-1')).toBe(
      resolveRequestId('client-id-1'),
    );
  });
});

describe('assignRequestId', () => {
  function capture(header: string | string[] | undefined): {
    id: string;
    setHeader: ReturnType<typeof vi.fn>;
  } {
    const setHeader = vi.fn();
    const req = { headers: { 'x-request-id': header } } as unknown as Request;
    const res = { setHeader } as unknown as Response;
    const id = assignRequestId(req, res);
    return { id, setHeader };
  }

  it('合法標頭寫回 X-Request-Id', () => {
    const { id, setHeader } = capture('client-id-1');
    expect(id).toBe('client-id-1');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-id-1');
  });

  it('不合法標頭重產後仍寫回', () => {
    const { id, setHeader } = capture('a/b');
    expect(id).toMatch(UUID);
    expect(id).not.toBe('a/b');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', id);
  });
});
