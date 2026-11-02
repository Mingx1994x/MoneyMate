import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsByteLength,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmptyToNull, IsName, Trim } from '../../../common/validators.js';

export class RegisterDto {
  @ApiProperty({
    description:
      'Email，後端去除前後空白並轉成小寫後儲存與比對。只接受半形英數與符號（不接受中文等非 ASCII 字元）',
    maxLength: 254,
    example: 'shin@example.com',
  })
  @Trim()
  @IsEmail()
  // 只收 ASCII：資料庫有 `email = lower(email)` 的 CHECK，JavaScript 與 PostgreSQL 對
  // 非 ASCII 字元（例如土耳其文的 İ）轉小寫的結果可能不同，會變成寫入失敗（500）
  @Matches(/^[\x21-\x7E]+$/, { message: 'email 只能包含半形英數與符號' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    description:
      '密碼，8–72 字元，而且 UTF-8 編碼不超過 72 bytes（bcrypt 的上限；中文一個字約 3 bytes）',
    minLength: 8,
    maxLength: 72,
    example: 'correct-horse-battery',
  })
  @IsString()
  @MinLength(8)
  @IsByteLength(0, 72)
  password!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      '顯示名稱，選填，去除前後空白後 1–30 字；空字串當作沒填（null）',
    maxLength: 30,
    example: 'Shin',
  })
  @IsOptional()
  @Trim()
  @EmptyToNull()
  @IsName()
  displayName?: string | null;
}
