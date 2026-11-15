// 建立 shadow_check，只給 prisma migrate diff 重放 migration。CI 每次都是空的 PostgreSQL；本機建一次即可。
// 刻意不 import dotenv。名稱規則與 assert-shadow-db.mjs 相同。
// 錯誤訊息只寫變數名稱或 PostgreSQL 錯誤代碼，不印出連線字串。

import pg from 'pg';

function databaseName(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`create-shadow-db: ${key} is not set`);
    process.exit(1);
  }

  try {
    return new URL(value).pathname.replace(/^\//, '');
  } catch {
    console.error(`create-shadow-db: ${key} is not a valid URL`);
    process.exit(1);
  }
}

if (databaseName('SHADOW_DATABASE_URL') !== 'shadow_check') {
  console.error(
    'create-shadow-db: SHADOW_DATABASE_URL database name must be shadow_check',
  );
  process.exit(1);
}

if (!databaseName('DIRECT_URL').endsWith('_test')) {
  console.error(
    'create-shadow-db: DIRECT_URL database name must end with _test',
  );
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
let exitCode = 0;

try {
  await client.connect();
  // 參數用字面 shadow_check，不把 URL 路徑串進 SQL。
  const existing = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    ['shadow_check'],
  );
  if ((existing.rowCount ?? 0) > 0) {
    console.error('create-shadow-db: shadow_check already exists');
    exitCode = 1;
  } else {
    await client.query('CREATE DATABASE shadow_check');
    console.log('create-shadow-db: ok');
  }
} catch (err) {
  const code =
    err && typeof err === 'object' && 'code' in err ? err.code : 'failed';
  console.error(`create-shadow-db: ${String(code)}`);
  exitCode = 1;
} finally {
  await client.end();
}

process.exit(exitCode);
