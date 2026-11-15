import { Global, Module } from '@nestjs/common';
import { ClockService } from './clock.service.js';

// 所有業務模組都會用到，跟 PrismaModule 一樣設成全域，不必各自 import
@Global()
@Module({
  providers: [ClockService],
  exports: [ClockService],
})
export class ClockModule {}
