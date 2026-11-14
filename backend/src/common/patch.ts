/**
 * PATCH 的工具。DTO 實例上沒傳的欄位仍是自有屬性、值是 undefined（target ES2023 的 class fields），所以：
 * - 不可以用 `'x' in dto`、`Object.keys(dto)` 判斷有沒有傳。
 * - 不可以 `{ ...current, ...dto }`：沒傳的欄位會被蓋成 undefined。
 * - 不可以 `dto.x ?? current.x`：會把「傳 null 清空」當成沒傳。
 */

/** 只留下有傳的欄位（值不是 undefined）；null 保留，代表清空。 */
export function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * 原值合併 PATCH，沒傳的欄位保留原值。兩邊必須是同一種形狀：資料庫的列要先轉成
 * service 內部的形狀（日期、金額都是字串）再傳進來，型別會擋住 Date 與字串混在一起。
 * patch 多出 T 沒有的屬性時型別擋不住，不是資料欄位的屬性（例如 keepCurrent）先拿掉。
 */
export function mergePatch<T extends object>(current: T, patch: Partial<T>): T {
  return { ...current, ...definedOnly(patch) };
}
