import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsId, ParseIdPipe } from '../../src/common/id.js';
import { PaginationQueryDto } from '../../src/common/pagination.dto.js';
import {
  EmptyToNull,
  IsBooleanQuery,
  IsDateOnly,
  IsMoney,
  IsName,
  IsNote,
  Trim,
} from '../../src/common/validators.js';

// 只給 validation 的 e2e 用：handler 把驗證、轉換後的 DTO 原樣回傳

class ItemDto {
  @IsMoney({ sign: 'positive' })
  amount!: string;
}

export class ValidationCreateDto {
  @Trim()
  @IsName()
  name!: string;

  @IsMoney({ sign: 'positive' })
  amount!: string;

  @IsId('ACCOUNT_NOT_FOUND')
  accountId!: string;

  @IsDateOnly()
  date!: string;

  @IsOptional()
  @EmptyToNull()
  @IsNote()
  note?: string | null;

  @ValidateIf((_, v) => v !== undefined)
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items?: ItemDto[];
}

class ValidationUpdateDto extends PartialType(ValidationCreateDto, {
  skipNullProperties: false,
}) {
  @IsOptional()
  note?: string | null;
}

// 反例：Create DTO 寫了屬性初始值，PartialType 會把它繼承到 PATCH DTO（README 規定不可以這樣寫）
class WithInitializerDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['active', 'closed'])
  status?: string = 'active';

  @ValidateIf((_, v) => v !== undefined)
  @IsName()
  name?: string;
}

class WithInitializerUpdateDto extends PartialType(WithInitializerDto, {
  skipNullProperties: false,
}) {}

class ValidationListQueryDto extends PaginationQueryDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsBooleanQuery()
  includeInactive?: boolean;
}

@Controller('__validation-test')
export class ValidationTestController {
  @Post()
  create(@Body() dto: ValidationCreateDto): ValidationCreateDto {
    return dto;
  }

  @Get()
  list(@Query() query: ValidationListQueryDto): ValidationListQueryDto {
    return query;
  }

  @Get('no-dto')
  noDto(): { ok: true } {
    return { ok: true };
  }

  @Patch('initializer')
  patchWithInitializer(
    @Body() dto: WithInitializerUpdateDto,
  ): WithInitializerUpdateDto {
    return dto;
  }

  @Patch(':id')
  update(
    @Param('id', new ParseIdPipe('LOAN_NOT_FOUND')) _id: string,
    @Body() dto: ValidationUpdateDto,
  ): ValidationUpdateDto {
    return dto;
  }
}
