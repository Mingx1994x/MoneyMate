// 只給 export.ts 當第一個 import：ConfigModule.forRoot 在 import app.module.js 時就會驗證環境變數。
// 無條件覆寫，每個人匯出的結果才會一樣。測試不要 import 這個檔案（改不回來），改用 export-env.constants.ts。
import { OPENAPI_EXPORT_ENV } from './export-env.constants.js';

Object.assign(process.env, OPENAPI_EXPORT_ENV);
