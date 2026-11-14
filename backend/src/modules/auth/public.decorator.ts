import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 不需要登入的端點（register、login、/health）。JwtAuthGuard 是全域的，
 * 沒加這個的端點一律要帶 token；可以加在方法或整個 controller 上。
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
