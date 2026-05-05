import { execute, selectOne } from "../../db";

const KEY = "git_author_emails";

type Row = { value: string };

export async function getAuthorEmails(): Promise<string[]> {
  const row = await selectOne<Row>(
    "SELECT value FROM app_meta WHERE key = ?",
    [KEY],
  );
  if (!row?.value) return [];
  return splitEmails(row.value);
}

export async function setAuthorEmails(value: string): Promise<void> {
  const cleaned = splitEmails(value).join(", ");
  await execute(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    [KEY, cleaned],
  );
}

export function splitEmails(input: string): string[] {
  return input
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
