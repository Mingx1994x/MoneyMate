-- 只在資料庫「第一次」建立時執行（volume 是空的時候）
-- app_dev 由 docker-compose.yml 的 POSTGRES_DB 建立；這裡再建一個測試專用的 app_test
CREATE DATABASE app_test;
