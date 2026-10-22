// enableImplicitConversion 要讀 design:type metadata；單獨 import 這個檔案（例如單元測試）時 Nest 還沒載入它
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const ORIGIN_PATTERN = /^https?:\/\/[^\s/:?#]+(:\d{1,5})?$/;

/**
 * 把 CORS_ORIGIN 正規化成 origin 清單：用逗號切開、去前後空白、去掉結尾的 `/`。
 * 驗證（validateEnv）與 CORS 設定（configureApp）共用，兩邊看到的清單一定相同。
 */
export function parseCorsOrigins(raw: string): string[] {
  return raw.split(',').map((item) => item.trim().replace(/\/+$/, ''));
}

@ValidatorConstraint({ name: 'corsOrigins' })
class CorsOriginsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const origins = parseCorsOrigins(value);
    return origins.every((origin) => ORIGIN_PATTERN.test(origin));
  }

  // 錯誤訊息不可用 $value：validationError.value = false 擋不住訊息內插
  defaultMessage(): string {
    return 'CORS_ORIGIN 必須是以逗號分隔的 http(s)://host[:port] 清單（不接受 *、空值或帶路徑的網址）';
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

  @Matches(/^postgres(ql)?:\/\//, {
    message: 'DATABASE_URL 必須是 postgresql:// 開頭的連線字串',
  })
  DATABASE_URL!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_MAX: number = 5;

  @Validate(CorsOriginsConstraint)
  CORS_ORIGIN!: string;
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
