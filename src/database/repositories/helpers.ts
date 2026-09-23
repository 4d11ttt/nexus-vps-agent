/**
 * Remove libsql's internal `_metadata` field from query results before
 * returning them to callers.
 */
export function cleanRow<T>(row: unknown): T | undefined {
  if (row === null || row === undefined) {
    return undefined;
  }
  if (typeof row !== 'object') {
    return row as T;
  }
  const copy = { ...(row as Record<string, unknown>) };
  delete copy._metadata;
  return copy as T;
}

export function cleanRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => cleanRow<T>(row) as T);
}
