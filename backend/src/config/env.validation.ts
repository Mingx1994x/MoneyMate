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
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';
import { parseCaCert } from './database-ssl.js';

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

@ValidatorConstraint({ name: 'caCert' })
class CaCertConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && parseCaCert(value) !== null;
  }

  defaultMessage(): string {
    return 'DATABASE_CA_CERT 必須是 PEM（可用字面的 \\n 代替換行）或 base64 編碼的 PEM；production 且 DATABASE_SSL=true 時必填';
  }
}

/**
 * JWT 簽章金鑰。每個環境都必填；production 至少 32 字元而且不可含 insecure
 * （.env.test.example 的假值刻意短於 32 字元並含 insecure，誤用到正式環境時啟動就會失敗）。
 */
@ValidatorConstraint({ name: 'jwtSecret' })
class JwtSecretConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string' || value.trim() === '') return false;
    if ((args.object as EnvVars).NODE_ENV !== 'production') return true;
    return value.length >= 32 && !value.toLowerCase().includes('insecure');
  }

  defaultMessage(): string {
    return 'JWT_SECRET 必填；production 至少 32 字元而且不可含 insecure（可用 openssl rand -base64 48 產生）';
  }
}

const TRUST_PROXY_HOPS_VALUES = Array.from({ length: 11 }, (_, i) => i);

/** 只把純數字字串轉成數字；''、'1.5'、'true' 原樣保留交給 @IsIn() 擋下（Number('') 會是 0） */
function parseIntString(raw: unknown): unknown {
  return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
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

  @Validate(JwtSecretConstraint)
  JWT_SECRET!: string;

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

  // DATABASE_SSL、TRUST_PROXY_HOPS 不可以寫初始值：plainToInstance 會先 new EnvVars()，
  // production 沒設時會直接拿到初始值而通過驗證。非 production 的預設值在 validateEnv 補上。

  /** 只接受 'true'／'false'；production 必填（Render 上設 true），其他環境沒設時為 false */
  @ValidateIf(
    (env: EnvVars) =>
      env.NODE_ENV === 'production' || env.DATABASE_SSL !== undefined,
  )
  @Transform(({ obj, key }) =>
    parseBooleanString((obj as Record<string, unknown>)[key]),
  )
  @IsBoolean({
    message: 'DATABASE_SSL 只接受 true／false；production 必填',
  })
  DATABASE_SSL!: boolean;

  /** production 且 DATABASE_SSL=true 時必填；有設就驗證格式。存原始值，用 parseCaCert 轉換 */
  @ValidateIf(
    (env: EnvVars) =>
      (env.NODE_ENV === 'production' && env.DATABASE_SSL === true) ||
      env.DATABASE_CA_CERT !== undefined,
  )
  @Validate(CaCertConstraint)
  DATABASE_CA_CERT?: string;

  /** 前面有幾層反向代理（trust proxy 用數字）。production 必填、沒有預設值；其他環境沒設時為 0 */
  @ValidateIf(
    (env: EnvVars) =>
      env.NODE_ENV === 'production' || env.TRUST_PROXY_HOPS !== undefined,
  )
  @Transform(({ obj, key }) =>
    parseIntString((obj as Record<string, unknown>)[key]),
  )
  @IsIn(TRUST_PROXY_HOPS_VALUES, {
    message: 'TRUST_PROXY_HOPS 必須是 0–10 的整數；production 必填',
  })
  TRUST_PROXY_HOPS!: number;
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
  // 只有非 production 會走到這裡還是 undefined（production 已被上面的驗證擋下）
  env.DATABASE_SSL ??= false;
  env.TRUST_PROXY_HOPS ??= 0;
  return env;
}
