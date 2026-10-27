import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync } from "node:fs";

/** Preserve damaged state before starting over; filesystem failures still surface to the caller. */
export function readStateFile<T>(path: string, valid: (value: unknown) => value is T, onRecovery: (message: string) => void): T | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  try {
    const value: unknown = JSON.parse(text);
    if (valid(value)) return value;
  } catch { /* Keep the original bytes for recovery below. */ }
  const backup = `${path}.corrupt-${randomUUID()}`;
  renameSync(path, backup);
  onRecovery(`Damaged state preserved at ${backup}. Starting fresh; uploads or pending answers may be retried.`);
  return null;
}
