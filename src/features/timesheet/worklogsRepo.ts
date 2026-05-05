import { execute, select, selectOne } from "../../db";

export type WorklogTotal = {
  issueKey: string;
  date: string;
  totalHours: number;
};

export type WorklogSyncStatus = "draft" | "submitted" | "modified" | "deleted";

export type WorklogEntry = {
  id: number;
  issueKey: string;
  date: string;
  timeSpentHours: number;
  comment: string;
  jiraWorklogId: string | null;
  syncStatus: WorklogSyncStatus;
  submitAttempts: number;
  createdAt: string;
  updatedAt: string;
};

type WorklogTotalRow = {
  issue_key: string;
  work_date: string;
  total_hours: number;
};

type WorklogEntryRow = {
  id: number;
  issue_key: string;
  work_date: string;
  time_spent_hours: number;
  comment: string;
  jira_worklog_id: string | null;
  sync_status: WorklogSyncStatus;
  submit_attempts: number | null;
  created_at: string;
  updated_at: string;
};

const ENTRY_COLUMNS =
  "id, issue_key, work_date, time_spent_hours, comment, jira_worklog_id, " +
  "sync_status, submit_attempts, created_at, updated_at";

function mapEntry(row: WorklogEntryRow): WorklogEntry {
  return {
    id: row.id,
    issueKey: row.issue_key,
    date: row.work_date,
    timeSpentHours: Number(row.time_spent_hours) || 0,
    comment: row.comment,
    jiraWorklogId: row.jira_worklog_id,
    syncStatus: row.sync_status,
    submitAttempts: Number(row.submit_attempts ?? 0) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type IssueWithWorklogsInRange = {
  issueKey: string;
  summary: string | null;
  status: string | null;
};

export async function listIssuesWithWorklogsInRange(
  startIsoDate: string,
  endIsoDate: string,
): Promise<IssueWithWorklogsInRange[]> {
  // Distinct issue keys that have any worklog row in the week (including
  // pending-delete, so the row stays visible while the delete syncs).
  // Joined with jira_issues for the cached summary; summary is null if the
  // issue was never cached (e.g. logged in Jira but never looked up locally).
  const rows = await select<{
    issue_key: string;
    summary: string | null;
    status: string | null;
  }>(
    "SELECT DISTINCT w.issue_key AS issue_key, " +
      "ji.summary AS summary, ji.status AS status " +
      "FROM worklogs w " +
      "LEFT JOIN jira_issues ji ON ji.issue_key = w.issue_key " +
      "WHERE w.work_date >= ? AND w.work_date <= ? " +
      "ORDER BY w.issue_key ASC",
    [startIsoDate, endIsoDate],
  );
  return rows.map((row) => ({
    issueKey: row.issue_key,
    summary: row.summary,
    status: row.status,
  }));
}

export async function getWorklogTotalsForRange(
  startIsoDate: string,
  endIsoDate: string,
): Promise<WorklogTotal[]> {
  const rows = await select<WorklogTotalRow>(
    "SELECT issue_key, work_date, SUM(time_spent_hours) AS total_hours " +
      "FROM worklogs " +
      "WHERE work_date >= ? AND work_date <= ? AND sync_status <> 'deleted' " +
      "GROUP BY issue_key, work_date",
    [startIsoDate, endIsoDate],
  );
  return rows.map((row) => ({
    issueKey: row.issue_key,
    date: row.work_date,
    totalHours: Number(row.total_hours) || 0,
  }));
}

export async function listWorklogsForCell(
  issueKey: string,
  isoDate: string,
): Promise<WorklogEntry[]> {
  // Include deleted entries so the popover can clearly mark them as
  // pending-deletion until the next submit (REQ-UI-010).
  const rows = await select<WorklogEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM worklogs ` +
      "WHERE issue_key = ? AND work_date = ? " +
      "ORDER BY CASE sync_status WHEN 'deleted' THEN 1 ELSE 0 END, " +
      "created_at ASC, id ASC",
    [issueKey, isoDate],
  );
  return rows.map(mapEntry);
}

export type CellSyncMarkers = {
  issueKey: string;
  date: string;
  hasDraft: boolean;
  hasModified: boolean;
  hasDeleted: boolean;
};

export async function getCellSyncMarkersForRange(
  startIsoDate: string,
  endIsoDate: string,
): Promise<CellSyncMarkers[]> {
  const rows = await select<{
    issue_key: string;
    work_date: string;
    sync_status: WorklogSyncStatus;
  }>(
    "SELECT DISTINCT issue_key, work_date, sync_status FROM worklogs " +
      "WHERE work_date >= ? AND work_date <= ? " +
      "AND sync_status IN ('draft', 'modified', 'deleted')",
    [startIsoDate, endIsoDate],
  );
  const map = new Map<string, CellSyncMarkers>();
  for (const row of rows) {
    const key = `${row.issue_key}|${row.work_date}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        issueKey: row.issue_key,
        date: row.work_date,
        hasDraft: false,
        hasModified: false,
        hasDeleted: false,
      };
      map.set(key, entry);
    }
    if (row.sync_status === "draft") entry.hasDraft = true;
    else if (row.sync_status === "modified") entry.hasModified = true;
    else if (row.sync_status === "deleted") entry.hasDeleted = true;
  }
  return [...map.values()];
}

export type WorklogInput = {
  timeSpentHours: number;
  comment: string;
};

function validateInput({ timeSpentHours, comment }: WorklogInput): void {
  if (!Number.isFinite(timeSpentHours) || timeSpentHours <= 0) {
    throw new Error("Hours must be a positive number.");
  }
  if (!comment.trim()) {
    throw new Error("Comment is required.");
  }
}

export async function createWorklog(
  issueKey: string,
  isoDate: string,
  input: WorklogInput,
): Promise<number> {
  validateInput(input);
  const result = await execute(
    "INSERT INTO worklogs (issue_key, work_date, time_spent_hours, comment, sync_status) " +
      "VALUES (?, ?, ?, ?, 'draft')",
    [issueKey, isoDate, input.timeSpentHours, input.comment.trim()],
  );
  return Number(result.lastInsertId ?? 0);
}

export async function updateWorklog(id: number, input: WorklogInput): Promise<void> {
  validateInput(input);
  // submitted → modified on edit; draft and modified keep their status.
  await execute(
    "UPDATE worklogs SET time_spent_hours = ?, comment = ?, " +
      "sync_status = CASE sync_status WHEN 'submitted' THEN 'modified' ELSE sync_status END, " +
      "updated_at = datetime('now') " +
      "WHERE id = ?",
    [input.timeSpentHours, input.comment.trim(), id],
  );
}

export async function listDraftWorklogs(): Promise<WorklogEntry[]> {
  const rows = await select<WorklogEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM worklogs ` +
      "WHERE sync_status = 'draft' " +
      "ORDER BY work_date ASC, created_at ASC, id ASC",
  );
  return rows.map(mapEntry);
}

export async function listModifiedWorklogs(): Promise<WorklogEntry[]> {
  const rows = await select<WorklogEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM worklogs ` +
      "WHERE sync_status = 'modified' " +
      "ORDER BY work_date ASC, created_at ASC, id ASC",
  );
  return rows.map(mapEntry);
}

export async function markWorklogSubmitted(
  id: number,
  jiraWorklogId: string,
): Promise<void> {
  await execute(
    "UPDATE worklogs SET jira_worklog_id = ?, sync_status = 'submitted', " +
      "submit_attempts = 0, updated_at = datetime('now') WHERE id = ?",
    [jiraWorklogId, id],
  );
}

export async function markWorklogUpdateSubmitted(id: number): Promise<void> {
  await execute(
    "UPDATE worklogs SET sync_status = 'submitted', submit_attempts = 0, " +
      "updated_at = datetime('now') WHERE id = ?",
    [id],
  );
}

export async function incrementWorklogSubmitAttempt(id: number): Promise<void> {
  // Bumped before each create call. If the network drops after Jira commits
  // but before we receive the response, the local row stays a draft with
  // attempts > 0 — the next retry uses that signal to look up the orphaned
  // remote worklog instead of creating a duplicate.
  await execute(
    "UPDATE worklogs SET submit_attempts = submit_attempts + 1 WHERE id = ?",
    [id],
  );
}

export async function listDeletedWorklogs(): Promise<WorklogEntry[]> {
  const rows = await select<WorklogEntryRow>(
    `SELECT ${ENTRY_COLUMNS} FROM worklogs ` +
      "WHERE sync_status = 'deleted' " +
      "ORDER BY work_date ASC, created_at ASC, id ASC",
  );
  return rows.map(mapEntry);
}

export async function removeWorklogLocally(id: number): Promise<void> {
  await execute("DELETE FROM worklogs WHERE id = ?", [id]);
}

export type MergeJiraWorklogInput = {
  issueKey: string;
  jiraWorklogId: string;
  isoDate: string;
  timeSpentHours: number;
  comment: string;
};

export type MergeJiraWorklogResult = "inserted" | "updated" | "preserved";

export async function mergeJiraWorklog(
  input: MergeJiraWorklogInput,
): Promise<MergeJiraWorklogResult> {
  // Local edits win: only 'submitted' rows are refreshed from Jira. Rows in
  // 'modified' or 'deleted' carry pending user intent and must survive until
  // the next submit reconciles them. Drafts never carry a jira_worklog_id.
  const existing = await selectOne<{ id: number; sync_status: WorklogSyncStatus }>(
    "SELECT id, sync_status FROM worklogs WHERE jira_worklog_id = ? LIMIT 1",
    [input.jiraWorklogId],
  );
  if (existing) {
    if (existing.sync_status !== "submitted") return "preserved";
    await execute(
      "UPDATE worklogs SET issue_key = ?, work_date = ?, time_spent_hours = ?, " +
        "comment = ?, updated_at = datetime('now') WHERE id = ?",
      [
        input.issueKey,
        input.isoDate,
        input.timeSpentHours,
        input.comment,
        existing.id,
      ],
    );
    return "updated";
  }
  await execute(
    "INSERT INTO worklogs (issue_key, work_date, time_spent_hours, comment, " +
      "jira_worklog_id, sync_status) VALUES (?, ?, ?, ?, ?, 'submitted')",
    [
      input.issueKey,
      input.isoDate,
      input.timeSpentHours,
      input.comment,
      input.jiraWorklogId,
    ],
  );
  return "inserted";
}

export async function reconcileRemovedWorklogs(
  issueKey: string,
  startIsoDate: string,
  endIsoDate: string,
  remoteJiraWorklogIds: ReadonlySet<string>,
): Promise<number> {
  // Find local 'submitted' rows in this window that no longer appear in
  // Jira's response — they were deleted upstream, so mirror the deletion.
  // 'modified' and 'deleted' rows are skipped: those represent pending
  // user intent and the submit flow handles 404s on its own.
  const rows = await select<{ id: number; jira_worklog_id: string | null }>(
    "SELECT id, jira_worklog_id FROM worklogs " +
      "WHERE issue_key = ? AND work_date >= ? AND work_date <= ? " +
      "AND sync_status = 'submitted' AND jira_worklog_id IS NOT NULL",
    [issueKey, startIsoDate, endIsoDate],
  );
  let removed = 0;
  for (const row of rows) {
    if (!row.jira_worklog_id) continue;
    if (remoteJiraWorklogIds.has(row.jira_worklog_id)) continue;
    await execute("DELETE FROM worklogs WHERE id = ?", [row.id]);
    removed += 1;
  }
  return removed;
}

export type PendingCounts = {
  drafts: number;
  modified: number;
  deleted: number;
  total: number;
};

export async function getPendingCounts(): Promise<PendingCounts> {
  const rows = await select<{ sync_status: WorklogSyncStatus; n: number }>(
    "SELECT sync_status, COUNT(*) AS n FROM worklogs " +
      "WHERE sync_status IN ('draft', 'modified', 'deleted') " +
      "GROUP BY sync_status",
  );
  const counts: PendingCounts = { drafts: 0, modified: 0, deleted: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.n) || 0;
    if (row.sync_status === "draft") counts.drafts = n;
    else if (row.sync_status === "modified") counts.modified = n;
    else if (row.sync_status === "deleted") counts.deleted = n;
  }
  counts.total = counts.drafts + counts.modified + counts.deleted;
  return counts;
}

export async function restoreWorklog(id: number): Promise<void> {
  // Undo a pending-delete by flipping back to 'submitted'. Only meaningful
  // for entries that have a Jira worklog ID — pure drafts are hard-deleted
  // by deleteWorklog and never reach 'deleted' status.
  await execute(
    "UPDATE worklogs SET sync_status = 'submitted', updated_at = datetime('now') " +
      "WHERE id = ? AND sync_status = 'deleted' AND jira_worklog_id IS NOT NULL",
    [id],
  );
}

export async function deleteWorklog(id: number): Promise<void> {
  // Drafts have never been submitted to Jira, so a hard delete is safe.
  // Synced entries (submitted/modified) are kept and flagged so the next
  // submit can issue a Jira delete; modified-then-deleted still becomes
  // deleted because the user's intent is to remove the entry.
  const row = await selectOne<{ sync_status: WorklogSyncStatus }>(
    "SELECT sync_status FROM worklogs WHERE id = ?",
    [id],
  );
  if (!row) return;
  if (row.sync_status === "draft") {
    await execute("DELETE FROM worklogs WHERE id = ?", [id]);
    return;
  }
  await execute(
    "UPDATE worklogs SET sync_status = 'deleted', updated_at = datetime('now') " +
      "WHERE id = ?",
    [id],
  );
}
