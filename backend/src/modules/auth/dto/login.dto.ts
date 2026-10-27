import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { Trim } from '../../../common/validators.js';

/** 登入只檢查有沒有填：格式不對的 Email、長度不對的密碼一律回 AUTH_INVALID_CREDENTIALS */
export class LoginDto {
  @ApiProperty({
    description: 'Email，不分大小寫',
    example: 'shin@example.com',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
