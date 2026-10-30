import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller.js';

// CategoriesService 在實作 PR 加入
@Module({
  controllers: [CategoriesController],
})
export class CategoriesModule {}
