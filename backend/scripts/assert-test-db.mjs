// db:test:prepare 的第一步：確認要動的資料庫是 *_test，避免 migrate 或清資料打到 app_dev。
// 刻意不 import dotenv：只看 `dotenv run -f .env.test` 注入的值與 shell 的值，
// 否則 .env.test 少寫的變數會被 .env 補上，悄悄連到開發資料庫。
// 錯誤訊息只寫變數名稱，不印出連線字串。

for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  const value = process.env[key];
  if (!value) {
    console.error(`assert-test-db: ${key} is not set`);
    process.exit(1);
  }

  let databaseName;
  try {
    databaseName = new URL(value).pathname.replace(/^\//, '');
  } catch {
    console.error(`assert-test-db: ${key} is not a valid URL`);
    process.exit(1);
  }

  if (!databaseName.endsWith('_test')) {
    console.error(`assert-test-db: ${key} database name must end with _test`);
    process.exit(1);
  }
}

console.log('assert-test-db: ok');
