import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, select } from "../../db";
import { addWeekPick, listWeekPicks, removeWeekPick } from "./weekPicksRepo";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  select: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectMock = vi.mocked(select);

describe("weekPicksRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1 });
  });

  it("lists picks with cached summaries for a week", async () => {
    selectMock.mockResolvedValue([
      {
        id: 1,
        issue_key: "ABC-1",
        summary: "Summary",
        week_start: "2026-05-04",
        created_at: "2026-05-05",
      },
    ]);

    const picks = await listWeekPicks("2026-05-04");

    expect(picks).toEqual([
      {
        id: 1,
        issueKey: "ABC-1",
        summary: "Summary",
        weekStart: "2026-05-04",
        createdAt: "2026-05-05",
      },
    ]);
  });

  it("adds picks idempotently", async () => {
    await addWeekPick("ABC-1", "2026-05-04");

    expect(executeMock).toHaveBeenCalledWith(
      "INSERT OR IGNORE INTO week_picks (issue_key, week_start) VALUES (?, ?)",
      ["ABC-1", "2026-05-04"],
    );
  });

  it("removes picks by issue and week", async () => {
    await removeWeekPick("ABC-1", "2026-05-04");

    expect(executeMock).toHaveBeenCalledWith(
      "DELETE FROM week_picks WHERE issue_key = ? AND week_start = ?",
      ["ABC-1", "2026-05-04"],
    );
  });
});
