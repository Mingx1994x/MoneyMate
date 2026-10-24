// enableImplicitConversion 要讀 design:type metadata；單獨 import 這個檔案（例如單元測試）時 Nest 還沒載入它
import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import { parseBooleanString } from '../common/boolean-string.js';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * 把 CORS_ORIGIN 正規化成 origin 清單：用逗號切開、去前後空白、去掉結尾的 `/`。
 * 驗證（validateEnv）與 CORS 設定（configureApp）共用，兩邊看到的清單一定相同。
 */
export function parseCorsOrigins(raw: string): string[] {
  return raw.split(',').map((item) => item.trim().replace(/\/+$/, ''));
}

/**
 * 每一項都要和瀏覽器送出的 Origin 完全一樣，cors 才比對得到：
 * 只有 http(s)、小寫 host、不帶預設 port、不帶路徑或帳密。
 * 用 URL 解析後要求 `origin === 原字串`，寫錯的設定在啟動時就失敗，而不是到部署後 CORS 默默失效。
 */
function isExactOrigin(item: string): boolean {
  if (!URL.canParse(item)) return false;
  const url = new URL(item);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.origin === item
  );
}

// 錯誤訊息不可用 $value：validationError.value = false 擋不住訊息內插
@ValidatorConstraint({ name: 'corsOrigins' })
class CorsOriginsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && parseCorsOrigins(value).every(isExactOrigin)
    );
  }

  defaultMessage(): string {
    return 'CORS_ORIGIN 必須是以逗號分隔的 http(s)://host[:port] 清單：host 小寫、不寫預設 port、不帶路徑（不接受 * 或空值）';
  }
}

@ValidatorConstraint({ name: 'postgresUrl' })
class PostgresUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      /^postgres(ql)?:\/\//.test(value) &&
      URL.canParse(value) &&
      new URL(value).hostname !== ''
    );
  }

  defaultMessage(): string {
    return 'DATABASE_URL 必須是 postgresql:// 開頭、可解析的連線字串（密碼中的 #、@、/ 等特殊字元要先做 URL 編碼）';
  }
}

/**
 * 唯一的環境變數驗證 class。新增必填變數時，同一個 PR 要一併更新
 * .env.example、.env.test.example、CI workflow 的 env（骨架規格 5.4）。
 */
export class EnvVars {
  @IsIn(NODE_ENVS)
  NODE_ENV!: NodeEnv;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @Validate(PostgresUrlConstraint)
  DATABASE_URL!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX: number = 5;

  @Validate(CorsOriginsConstraint)
  CORS_ORIGIN!: string;

  /**
   * 只接受 'true'／'false'；沒設時依 NODE_ENV 決定（見 isSwaggerEnabled）。
   * 一定要讀原始的 obj[key]：enableImplicitConversion 已經把 value 轉成 Boolean('false') === true。
   */
  @IsOptional()
  @Transform(({ obj, key }) =>
    parseBooleanString((obj as Record<string, unknown>)[key]),
  )
  @IsBoolean()
  SWAGGER_ENABLED?: boolean;
}

/** Swagger UI 是否掛載：有設 SWAGGER_ENABLED 就照設定，沒設時 production 關、其他開 */
export function isSwaggerEnabled(
  env: Pick<EnvVars, 'NODE_ENV' | 'SWAGGER_ENABLED'>,
): boolean {
  return env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
}

/**
 * 給 ConfigModule.forRoot({ validate }) 用。失敗時列出所有不合格的變數名稱與規則，
 * 不輸出任何值（避免連線字串的密碼進入部署平台的日誌）。
 */
export function validateEnv(config: Record<string, unknown>): EnvVars {
  const env = plainToInstance(EnvVars, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, {
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    const lines = errors.map(
      (error) =>
        `  - ${error.property}: ${Object.values(error.constraints ?? {}).join('；')}`,
    );
    throw new Error(`環境變數設定錯誤：\n${lines.join('\n')}`);
  }
  return env;
}
