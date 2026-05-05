import { invoke } from "@tauri-apps/api/core";
import { execute, getDb, selectOne } from "./client";

export async function initDb(): Promise<void> {
  await getDb();
  await execute(
    "INSERT INTO app_meta(key, value) VALUES('schema_ready', '1') " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
  );
  const row = await selectOne<{ value: string }>(
    "SELECT value FROM app_meta WHERE key = ?",
    ["schema_ready"],
  );
  if (row?.value !== "1") {
    throw new Error("app_meta read-back returned unexpected value");
  }
  await invoke("migrate_jira_api_token");
}
