// db:drift 的第一步：確認 shadow 與 migrate 用的是兩個不同、名稱符合規定的資料庫。
// 刻意不 import dotenv、不連線：只看 `dotenv run -f .env.test` 注入的值與 shell 的值。
// 錯誤訊息只寫變數名稱，不印出連線字串。

function databaseName(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`assert-shadow-db: ${key} is not set`);
    process.exit(1);
  }

  try {
    return new URL(value).pathname.replace(/^\//, '');
  } catch {
    console.error(`assert-shadow-db: ${key} is not a valid URL`);
    process.exit(1);
  }
}

if (databaseName('SHADOW_DATABASE_URL') !== 'shadow_check') {
  console.error(
    'assert-shadow-db: SHADOW_DATABASE_URL database name must be shadow_check',
  );
  process.exit(1);
}

if (!databaseName('DIRECT_URL').endsWith('_test')) {
  console.error(
    'assert-shadow-db: DIRECT_URL database name must end with _test',
  );
  process.exit(1);
}

console.log('assert-shadow-db: ok');
