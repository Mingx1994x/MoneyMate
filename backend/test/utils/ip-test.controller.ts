import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

// 只給 trust proxy 的 e2e 用：回傳 Express 算出的 req.ip
@Controller('__ip-test')
export class IpTestController {
  @Get()
  ip(@Req() req: Request): { ip: string | undefined } {
    return { ip: req.ip };
  }
}
