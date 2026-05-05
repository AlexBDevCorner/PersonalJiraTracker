import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, select, selectOne } from "../../db";
import {
  ensureIssueStub,
  getCachedIssue,
  listCachedIssues,
  upsertDiscoveredIssue,
  upsertIssue,
} from "./issuesRepo";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  select: vi.fn(),
  selectOne: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectMock = vi.mocked(select);
const selectOneMock = vi.mocked(selectOne);

describe("issuesRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1 });
  });

  it("maps cached issue rows", async () => {
    selectOneMock.mockResolvedValue({
      issue_key: "ABC-1",
      summary: "Summary",
      status: "Open",
      url: "https://example.atlassian.net/browse/ABC-1",
      last_fetched_at: "2026-05-05",
    });

    const issue = await getCachedIssue("ABC-1");

    expect(issue).toEqual({
      issueKey: "ABC-1",
      summary: "Summary",
      status: "Open",
      url: "https://example.atlassian.net/browse/ABC-1",
      lastFetchedAt: "2026-05-05",
    });
  });

  it("returns null when a cached issue does not exist", async () => {
    selectOneMock.mockResolvedValue(null);

    await expect(getCachedIssue("ABC-1")).resolves.toBeNull();
  });

  it("lists cached issues using the requested limit", async () => {
    selectMock.mockResolvedValue([
      {
        issue_key: "ABC-1",
        summary: null,
        status: null,
        url: null,
        last_fetched_at: null,
      },
    ]);

    const issues = await listCachedIssues({ limit: 10 });

    expect(issues).toEqual([
      {
        issueKey: "ABC-1",
        summary: null,
        status: null,
        url: null,
        lastFetchedAt: null,
      },
    ]);
    expect(selectMock).toHaveBeenCalledWith(expect.any(String), [10]);
  });

  it("upserts fetched Jira issue details", async () => {
    await upsertIssue({
      issueKey: "ABC-1",
      summary: "Summary",
      status: "Open",
      url: "https://example.atlassian.net/browse/ABC-1",
    });

    expect(executeMock).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"), [
      "ABC-1",
      "Summary",
      "Open",
      "https://example.atlassian.net/browse/ABC-1",
    ]);
  });

  it("creates placeholder issue rows for foreign-key callers", async () => {
    await ensureIssueStub("ABC-1");

    expect(executeMock).toHaveBeenCalledWith(
      "INSERT OR IGNORE INTO jira_issues (issue_key, summary, status, url, last_fetched_at) " +
        "VALUES (?, NULL, NULL, NULL, NULL)",
      ["ABC-1"],
    );
  });

  it("upserts discovered issues without overwriting existing URLs", async () => {
    await upsertDiscoveredIssue("ABC-1", "Summary", "Open");

    expect(executeMock).toHaveBeenCalledWith(
      expect.not.stringContaining("url = excluded.url"),
      ["ABC-1", "Summary", "Open"],
    );
  });
});
