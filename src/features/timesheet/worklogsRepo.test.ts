import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, select, selectOne } from "../../db";
import {
  createWorklog,
  deleteWorklog,
  getCellSyncMarkersForRange,
  getPendingCounts,
  getWorklogTotalsForRange,
  mergeJiraWorklog,
  reconcileRemovedWorklogs,
  updateWorklog,
} from "./worklogsRepo";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  select: vi.fn(),
  selectOne: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectMock = vi.mocked(select);
const selectOneMock = vi.mocked(selectOne);

describe("worklogsRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 88 });
  });

  it("creates a draft worklog with a trimmed comment", async () => {
    const id = await createWorklog("ABC-1", "2026-05-05", {
      timeSpentHours: 1.5,
      comment: "  Work done  ",
    });

    expect(id).toBe(88);
    expect(executeMock).toHaveBeenCalledWith(
      "INSERT INTO worklogs (issue_key, work_date, time_spent_hours, comment, sync_status) " +
        "VALUES (?, ?, ?, ?, 'draft')",
      ["ABC-1", "2026-05-05", 1.5, "Work done"],
    );
  });

  it("validates worklog hours and comments", async () => {
    await expect(
      createWorklog("ABC-1", "2026-05-05", { timeSpentHours: 0, comment: "x" }),
    ).rejects.toThrow("Hours must be a positive number.");
    await expect(
      createWorklog("ABC-1", "2026-05-05", { timeSpentHours: 1, comment: " " }),
    ).rejects.toThrow("Comment is required.");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("marks submitted worklogs as modified when updating", async () => {
    await updateWorklog(5, { timeSpentHours: 2, comment: "  Updated  " });

    expect(executeMock).toHaveBeenCalledWith(
      "UPDATE worklogs SET time_spent_hours = ?, comment = ?, " +
        "sync_status = CASE sync_status WHEN 'submitted' THEN 'modified' ELSE sync_status END, " +
        "updated_at = datetime('now') " +
        "WHERE id = ?",
      [2, "Updated", 5],
    );
  });

  it("maps totals and coerces missing totals to zero", async () => {
    selectMock.mockResolvedValue([
      { issue_key: "ABC-1", work_date: "2026-05-05", total_hours: 3.25 },
      { issue_key: "ABC-2", work_date: "2026-05-06", total_hours: null },
    ]);

    const totals = await getWorklogTotalsForRange("2026-05-04", "2026-05-10");

    expect(totals).toEqual([
      { issueKey: "ABC-1", date: "2026-05-05", totalHours: 3.25 },
      { issueKey: "ABC-2", date: "2026-05-06", totalHours: 0 },
    ]);
  });

  it("combines sync markers per issue and date", async () => {
    selectMock.mockResolvedValue([
      { issue_key: "ABC-1", work_date: "2026-05-05", sync_status: "draft" },
      { issue_key: "ABC-1", work_date: "2026-05-05", sync_status: "modified" },
      { issue_key: "ABC-2", work_date: "2026-05-06", sync_status: "deleted" },
    ]);

    const markers = await getCellSyncMarkersForRange("2026-05-04", "2026-05-10");

    expect(markers).toEqual([
      {
        issueKey: "ABC-1",
        date: "2026-05-05",
        hasDraft: true,
        hasModified: true,
        hasDeleted: false,
      },
      {
        issueKey: "ABC-2",
        date: "2026-05-06",
        hasDraft: false,
        hasModified: false,
        hasDeleted: true,
      },
    ]);
  });

  it("updates submitted Jira worklogs during merge", async () => {
    selectOneMock.mockResolvedValue({ id: 5, sync_status: "submitted" });

    const result = await mergeJiraWorklog({
      issueKey: "ABC-1",
      jiraWorklogId: "remote-1",
      isoDate: "2026-05-05",
      timeSpentHours: 2,
      comment: "Remote",
    });

    expect(result).toBe("updated");
    expect(executeMock).toHaveBeenCalledWith(
      "UPDATE worklogs SET issue_key = ?, work_date = ?, time_spent_hours = ?, " +
        "comment = ?, updated_at = datetime('now') WHERE id = ?",
      ["ABC-1", "2026-05-05", 2, "Remote", 5],
    );
  });

  it("preserves local pending edits during Jira merge", async () => {
    selectOneMock.mockResolvedValue({ id: 5, sync_status: "modified" });

    const result = await mergeJiraWorklog({
      issueKey: "ABC-1",
      jiraWorklogId: "remote-1",
      isoDate: "2026-05-05",
      timeSpentHours: 2,
      comment: "Remote",
    });

    expect(result).toBe("preserved");
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("inserts Jira worklogs that do not exist locally", async () => {
    selectOneMock.mockResolvedValue(null);

    const result = await mergeJiraWorklog({
      issueKey: "ABC-1",
      jiraWorklogId: "remote-1",
      isoDate: "2026-05-05",
      timeSpentHours: 2,
      comment: "Remote",
    });

    expect(result).toBe("inserted");
    expect(executeMock).toHaveBeenCalledWith(
      "INSERT INTO worklogs (issue_key, work_date, time_spent_hours, comment, " +
        "jira_worklog_id, sync_status) VALUES (?, ?, ?, ?, ?, 'submitted')",
      ["ABC-1", "2026-05-05", 2, "Remote", "remote-1"],
    );
  });

  it("reconciles removed remote worklogs", async () => {
    selectMock.mockResolvedValue([
      { id: 1, jira_worklog_id: "keep" },
      { id: 2, jira_worklog_id: "remove" },
      { id: 3, jira_worklog_id: null },
    ]);

    const removed = await reconcileRemovedWorklogs(
      "ABC-1",
      "2026-05-04",
      "2026-05-10",
      new Set(["keep"]),
    );

    expect(removed).toBe(1);
    expect(executeMock).toHaveBeenCalledWith("DELETE FROM worklogs WHERE id = ?", [2]);
  });

  it("counts pending worklogs by status", async () => {
    selectMock.mockResolvedValue([
      { sync_status: "draft", n: 2 },
      { sync_status: "modified", n: 1 },
      { sync_status: "deleted", n: 3 },
    ]);

    const counts = await getPendingCounts();

    expect(counts).toEqual({ drafts: 2, modified: 1, deleted: 3, total: 6 });
  });

  it("hard-deletes drafts and marks synced worklogs deleted", async () => {
    selectOneMock.mockResolvedValueOnce({ sync_status: "draft" });
    await deleteWorklog(1);

    selectOneMock.mockResolvedValueOnce({ sync_status: "submitted" });
    await deleteWorklog(2);

    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      "DELETE FROM worklogs WHERE id = ?",
      [1],
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      "UPDATE worklogs SET sync_status = 'deleted', updated_at = datetime('now') " +
        "WHERE id = ?",
      [2],
    );
  });
});
