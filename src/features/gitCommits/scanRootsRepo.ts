import { execute, select } from "../../db";

export type ScanRoot = {
  path: string;
  createdAt: string;
};

type Row = { path: string; created_at: string };

export async function listScanRoots(): Promise<ScanRoot[]> {
  const rows = await select<Row>(
    "SELECT path, created_at FROM git_scan_roots ORDER BY created_at ASC, path ASC",
  );
  return rows.map((r) => ({ path: r.path, createdAt: r.created_at }));
}

export async function addScanRoot(path: string): Promise<void> {
  await execute(
    "INSERT OR IGNORE INTO git_scan_roots (path) VALUES (?)",
    [path],
  );
}

export async function removeScanRoot(path: string): Promise<void> {
  await execute("DELETE FROM git_scan_roots WHERE path = ?", [path]);
}
