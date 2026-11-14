import { ApiProperty } from '@nestjs/swagger';

/** 登入者的資料（GET /auth/me，也放在註冊、登入的回應裡） */
export class MeDto {
  @ApiProperty({
    format: 'uuid',
    example: '3f0c9a52-6f1e-4d0a-9a51-2a4c1b7e8d10',
  })
  id!: string;

  @ApiProperty({ description: '小寫的 Email', example: 'shin@example.com' })
  email!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '顯示名稱，沒填時是 null',
    example: 'Shin',
  })
  displayName!: string | null;

  @ApiProperty({
    description:
      '是否完成問卷（有目標資料就是 true）。false 時前端一律導向問卷頁',
    example: false,
  })
  hasCompletedOnboarding!: boolean;
}

/** 註冊、登入的回應 */
export class AuthResponseDto {
  @ApiProperty({
    description:
      'access token，有效 24 小時，沒有 refresh token。之後的請求放在 `Authorization: Bearer <token>`',
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzZjBjOWE1MiJ9.signature',
  })
  accessToken!: string;

  @ApiProperty({ type: MeDto })
  user!: MeDto;
}
