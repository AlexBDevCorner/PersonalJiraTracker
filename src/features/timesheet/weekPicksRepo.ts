import { execute, select } from "../../db";

export type WeekPick = {
  id: number;
  issueKey: string;
  summary: string | null;
  weekStart: string;
  createdAt: string;
};

type WeekPickRow = {
  id: number;
  issue_key: string;
  summary: string | null;
  week_start: string;
  created_at: string;
};

export async function listWeekPicks(weekStartIso: string): Promise<WeekPick[]> {
  const rows = await select<WeekPickRow>(
    "SELECT wp.id AS id, wp.issue_key AS issue_key, " +
      "ji.summary AS summary, wp.week_start AS week_start, " +
      "wp.created_at AS created_at " +
      "FROM week_picks wp " +
      "LEFT JOIN jira_issues ji ON ji.issue_key = wp.issue_key " +
      "WHERE wp.week_start = ? " +
      "ORDER BY wp.created_at ASC, wp.id ASC",
    [weekStartIso],
  );
  return rows.map((row) => ({
    id: row.id,
    issueKey: row.issue_key,
    summary: row.summary,
    weekStart: row.week_start,
    createdAt: row.created_at,
  }));
}

export async function addWeekPick(
  issueKey: string,
  weekStartIso: string,
): Promise<void> {
  // INSERT OR IGNORE so re-picking an issue already on the week is a no-op
  // instead of an error — the UI calls this from multiple places.
  await execute(
    "INSERT OR IGNORE INTO week_picks (issue_key, week_start) VALUES (?, ?)",
    [issueKey, weekStartIso],
  );
}

export async function removeWeekPick(
  issueKey: string,
  weekStartIso: string,
): Promise<void> {
  await execute(
    "DELETE FROM week_picks WHERE issue_key = ? AND week_start = ?",
    [issueKey, weekStartIso],
  );
}
