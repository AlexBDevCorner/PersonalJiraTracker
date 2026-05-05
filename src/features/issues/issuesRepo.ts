import { execute, select, selectOne } from "../../db";
import type { JiraIssue } from "../../jira";

export type CachedIssue = {
  issueKey: string;
  summary: string | null;
  status: string | null;
  url: string | null;
  lastFetchedAt: string | null;
};

type IssueRow = {
  issue_key: string;
  summary: string | null;
  status: string | null;
  url: string | null;
  last_fetched_at: string | null;
};

export async function getCachedIssue(issueKey: string): Promise<CachedIssue | null> {
  const row = await selectOne<IssueRow>(
    "SELECT issue_key, summary, status, url, last_fetched_at FROM jira_issues WHERE issue_key = ?",
    [issueKey],
  );
  if (!row) return null;
  return {
    issueKey: row.issue_key,
    summary: row.summary,
    status: row.status,
    url: row.url,
    lastFetchedAt: row.last_fetched_at,
  };
}

export async function listCachedIssues(
  options: { limit?: number } = {},
): Promise<CachedIssue[]> {
  const { limit = 50 } = options;
  const rows = await select<IssueRow>(
    "SELECT issue_key, summary, status, url, last_fetched_at FROM jira_issues " +
      "ORDER BY last_fetched_at DESC, issue_key ASC " +
      "LIMIT ?",
    [limit],
  );
  return rows.map((row) => ({
    issueKey: row.issue_key,
    summary: row.summary,
    status: row.status,
    url: row.url,
    lastFetchedAt: row.last_fetched_at,
  }));
}

export async function upsertIssue(issue: JiraIssue): Promise<void> {
  await execute(
    "INSERT INTO jira_issues (issue_key, summary, status, url, last_fetched_at) " +
      "VALUES (?, ?, ?, ?, datetime('now')) " +
      "ON CONFLICT(issue_key) DO UPDATE SET " +
      "summary = excluded.summary, " +
      "status = excluded.status, " +
      "url = excluded.url, " +
      "last_fetched_at = excluded.last_fetched_at",
    [issue.issueKey, issue.summary, issue.status, issue.url],
  );
}

export async function ensureIssueStub(issueKey: string): Promise<void> {
  // Favorites and worklog rows reference jira_issues by FK, so callers that
  // want to act on a key the cache hasn't seen yet need a placeholder row first.
  await execute(
    "INSERT OR IGNORE INTO jira_issues (issue_key, summary, status, url, last_fetched_at) " +
      "VALUES (?, NULL, NULL, NULL, NULL)",
    [issueKey],
  );
}

export async function upsertDiscoveredIssue(
  issueKey: string,
  summary: string | null,
  status: string | null,
): Promise<void> {
  // Used by the worklog hydration flow. JQL search doesn't carry a browse URL,
  // so leave url alone on conflict — preserves whatever lookupJiraIssue cached.
  await execute(
    "INSERT INTO jira_issues (issue_key, summary, status, url, last_fetched_at) " +
      "VALUES (?, ?, ?, NULL, datetime('now')) " +
      "ON CONFLICT(issue_key) DO UPDATE SET " +
      "summary = excluded.summary, " +
      "status = excluded.status, " +
      "last_fetched_at = excluded.last_fetched_at",
    [issueKey, summary, status],
  );
}
