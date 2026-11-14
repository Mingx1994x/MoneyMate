const PEM_BEGIN = '-----BEGIN CERTIFICATE-----';
const PEM_END = '-----END CERTIFICATE-----';

/**
 * 把 DATABASE_CA_CERT 轉成 PEM。接受兩種格式：
 * - PEM：字面的 `\n` 轉回換行（部署平台的單行輸入框常見）。
 * - base64 編碼的 PEM（Render 上建議用這種，一行、不怕換行被吃掉）。
 * 轉不成 PEM 就回 null。驗證（validateEnv）與 PrismaService 共用，兩邊的結果一定相同。
 */
export function parseCaCert(raw: string): string | null {
  const text = raw.trim();
  const pem = text.includes('-----BEGIN')
    ? text.replace(/\\n/g, '\n')
    : Buffer.from(text, 'base64').toString('utf8').trim();
  return pem.includes(PEM_BEGIN) && pem.includes(PEM_END) ? pem : null;
}

/**
 * 傳給 PrismaPg（pg.Pool）的 ssl 設定。
 * - 不加密：本機 Docker。
 * - { ca }：驗證憑證鏈與主機名稱（Node TLS 預設 rejectUnauthorized: true）。
 *   禁止 rejectUnauthorized: false 與 NODE_TLS_REJECT_UNAUTHORIZED=0。
 * - true：用系統內建的 CA。Supabase 的 CA 不在系統裡，連 Supabase 會失敗，這是預期行為；
 *   production 走不到這裡（DATABASE_SSL=true 時 CA 必填）。
 * 連線字串不可以寫 sslmode：pg 會用 URL 裡的值蓋掉這裡的設定。
 */
export function buildSslOption(env: {
  DATABASE_SSL: boolean;
  DATABASE_CA_CERT?: string;
}): false | true | { ca: string } {
  if (!env.DATABASE_SSL) return false;
  if (env.DATABASE_CA_CERT === undefined) return true;
  const ca = parseCaCert(env.DATABASE_CA_CERT);
  // validateEnv 已經擋下轉不成 PEM 的值，這裡是保險
  if (ca === null)
    throw new Error('DATABASE_CA_CERT 不是 PEM 或 base64 編碼的 PEM');
  return { ca };
}
