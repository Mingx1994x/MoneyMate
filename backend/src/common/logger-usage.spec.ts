import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { Logger, PinoLogger } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';
import { createPinoLoggerParams } from './logger.js';

/**
 * 業務程式用 Nest 的 new Logger(ctx).log(obj, msg)，會轉成 nestjs-pino Logger 的 log(obj, msg, ctx)。
 * nestjs-pino 的 root logger 是程序裡的單例，第一個建立的決定輸出位置，
 * 所以獨立成一個檔（Vitest 每個檔各自載入模組），整個檔共用同一個 destination。
 */
const lines: string[] = [];
const destination = new Writable({
  write(chunk: unknown, _encoding, callback) {
    if (typeof chunk === 'string') lines.push(chunk);
    else if (Buffer.isBuffer(chunk)) lines.push(chunk.toString());
    callback();
  },
});
const params = createPinoLoggerParams({
  destination,
  level: 'info',
}) as unknown as Params<IncomingMessage, ServerResponse>;
const logger = new Logger(new PinoLogger(params), params);

beforeEach(() => {
  lines.length = 0;
});

describe('業務程式的日誌', () => {
  it('刪最外層與往下兩層的密碼、token；email 與訊息字串留著', () => {
    logger.log(
      {
        password: 'SECRET-PW',
        email: 'secret@example.com',
        headers: { authorization: 'Bearer SECRET-TK' },
        dto: { user: { currentPassword: 'SECRET-PW' } },
      },
      '登入 SECRET-MSG',
      'AuthService',
    );
    const text = lines.join('');
    expect(text).not.toContain('SECRET-PW');
    expect(text).not.toContain('SECRET-TK');
    expect(text).toContain('secret@example.com');
    expect(text).toContain('SECRET-MSG');
  });

  it('logger.error(error) 的 message 會變成 msg（README 列為不要）', () => {
    logger.error(new Error('SECRET-MSG'), 'BillsService');
    const text = lines.join('');
    expect(text).toContain('"msg":"SECRET-MSG"');
    expect(text).toContain('"err":{"type":"Error"}');
  });
});
