/**
 * 'true'／'false' 轉成布林，其他值原樣保留，交給後面的 @IsBoolean() 之類擋下。
 * 環境變數（SWAGGER_ENABLED）與布林 query（@IsBooleanQuery）共用。
 * 呼叫端要傳原始值（@Transform 的 obj[key]），不要傳已經被 implicit conversion 轉過的 value。
 */
export function parseBooleanString(raw: unknown): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}
