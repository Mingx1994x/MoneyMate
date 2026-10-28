import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller.js';

// AccountsService 在實作 PR 加入（含給 D 用的 createAccount(tx, …)）
@Module({
  controllers: [AccountsController],
})
export class AccountsModule {}
