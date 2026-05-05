import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { toDbError } from "./errors";

const DB_URL = "sqlite:jira_tracker.db";

let dbPromise: Promise<void> | null = null;

export function getDb(): Promise<void> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL)
      .then(() => undefined)
      .catch((cause) => {
        dbPromise = null;
        throw toDbError("load", cause);
      });
  }
  return dbPromise;
}

export type QueryResult = {
  rowsAffected: number;
  lastInsertId?: number;
};

export async function execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
  await getDb();
  try {
    return await invoke<QueryResult>("db_execute", { sql, params });
  } catch (cause) {
    throw toDbError("execute", cause);
  }
}

export async function select<Row = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<Row[]> {
  await getDb();
  try {
    return await invoke<Row[]>("db_select", { sql, params });
  } catch (cause) {
    throw toDbError("select", cause);
  }
}

export async function selectOne<Row = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<Row | null> {
  const rows = await select<Row>(sql, params);
  return rows[0] ?? null;
}
