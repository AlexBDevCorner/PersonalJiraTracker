import { execute, select, selectOne } from "../../db";

export async function listFavoriteIssueKeys(): Promise<Set<string>> {
  const rows = await select<{ issue_key: string }>(
    "SELECT DISTINCT issue_key FROM favorite_issues",
  );
  return new Set(rows.map((row) => row.issue_key));
}

export async function isFavoriteIssue(issueKey: string): Promise<boolean> {
  const row = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_issues WHERE issue_key = ? LIMIT 1",
    [issueKey],
  );
  return row != null;
}

export async function unpinIssueFromAllGroups(issueKey: string): Promise<void> {
  await execute("DELETE FROM favorite_issues WHERE issue_key = ?", [issueKey]);
}
