import { describe, expect, it, vi } from "vitest";
import { JiraNotFoundError } from "./errors";
import {
  createJiraWorklog,
  deleteJiraWorklog,
  fetchCurrentJiraUser,
  fetchJiraWorklogsForIssue,
  isValidIssueKey,
  normalizeIssueKey,
  searchIssuesAssignedToCurrentUser,
  searchIssuesWithUserWorklogsInRange,
  updateJiraWorklog,
  type JiraClient,
} from "./index";

function fakeClient(overrides: Partial<JiraClient>): JiraClient {
  return {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}

describe("issue key helpers", () => {
  it("normalizes and validates Jira issue keys", () => {
    expect(normalizeIssueKey(" abc_2-123 ")).toBe("ABC_2-123");
    expect(isValidIssueKey("abc-123")).toBe(true);
    expect(isValidIssueKey("1ABC-123")).toBe(false);
    expect(isValidIssueKey("ABC-")).toBe(false);
  });
});

describe("fetchCurrentJiraUser", () => {
  it("maps Jira user response with display-name fallback", async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ accountId: "acc-1" }),
    });

    await expect(fetchCurrentJiraUser(client)).resolves.toEqual({
      accountId: "acc-1",
      displayName: "Jira user",
      emailAddress: undefined,
    });
  });
});

describe("createJiraWorklog", () => {
  it("posts Jira ADF and converts hours to seconds", async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ id: 123 }),
    });

    const result = await createJiraWorklog(client, {
      issueKey: "abc-1",
      isoDate: "2026-05-05",
      timeSpentHours: 1.5,
      comment: "Work done",
    });

    expect(result).toEqual({ id: "123" });
    expect(client.post).toHaveBeenCalledWith(
      "/rest/api/3/issue/ABC-1/worklog",
      expect.objectContaining({
        timeSpentSeconds: 5400,
        comment: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Work done" }],
            },
          ],
        },
      }),
    );
  });

  it("throws when Jira omits the created worklog id", async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({}),
    });

    await expect(
      createJiraWorklog(client, {
        issueKey: "ABC-1",
        isoDate: "2026-05-05",
        timeSpentHours: 1,
        comment: "Work done",
      }),
    ).rejects.toThrow("Jira accepted the worklog but did not return an ID.");
  });
});

describe("updateJiraWorklog", () => {
  it("requires a Jira worklog id before updating", async () => {
    const client = fakeClient({});

    await expect(
      updateJiraWorklog(client, {
        issueKey: "ABC-1",
        jiraWorklogId: " ",
        isoDate: "2026-05-05",
        timeSpentHours: 1,
        comment: "Work done",
      }),
    ).rejects.toThrow("Jira worklog ID is required to update a worklog.");
  });
});

describe("deleteJiraWorklog", () => {
  it("normalizes issue keys and trims worklog ids", async () => {
    const client = fakeClient({ delete: vi.fn().mockResolvedValue(null) });

    await deleteJiraWorklog(client, {
      issueKey: "abc-1",
      jiraWorklogId: "  remote-1  ",
    });

    expect(client.delete).toHaveBeenCalledWith(
      "/rest/api/3/issue/ABC-1/worklog/remote-1",
    );
  });
});

describe("fetchJiraWorklogsForIssue", () => {
  it("paginates Jira worklogs and maps valid entries", async () => {
    const client = fakeClient({
      get: vi
        .fn()
        .mockResolvedValueOnce({
          total: 2,
          worklogs: [
            {
              id: "1",
              started: "2026-05-05T09:00:00.000+0000",
              timeSpentSeconds: 3600,
              comment: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "First" }],
                  },
                ],
              },
              author: { accountId: "acc-1" },
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          worklogs: [
            {
              id: 2,
              started: "2026-05-06T09:00:00.000+0000",
              timeSpentSeconds: 1800,
              comment: "Second",
              author: null,
            },
            { id: "", started: "2026-05-06T09:00:00.000+0000" },
          ],
        }),
    });

    const worklogs = await fetchJiraWorklogsForIssue(
      client,
      "abc-1",
      "2026-05-05",
      "2026-05-06",
    );

    expect(worklogs).toEqual([
      {
        id: "1",
        issueKey: "ABC-1",
        isoDate: "2026-05-05",
        timeSpentHours: 1,
        comment: "First",
        authorAccountId: "acc-1",
      },
      {
        id: "2",
        issueKey: "ABC-1",
        isoDate: "2026-05-06",
        timeSpentHours: 0.5,
        comment: "Second",
        authorAccountId: null,
      },
    ]);
    expect(client.get).toHaveBeenNthCalledWith(
      1,
      "/rest/api/3/issue/ABC-1/worklog",
      expect.objectContaining({ startAt: 0 }),
    );
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      "/rest/api/3/issue/ABC-1/worklog",
      expect.objectContaining({ startAt: 1 }),
    );
  });
});

describe("JQL search helpers", () => {
  it("uses the modern JQL endpoint and de-duplicates issue keys", async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({
        isLast: true,
        issues: [
          { key: "ABC-1", fields: { summary: "One", status: { name: "Open" } } },
          { key: "ABC-1", fields: { summary: "Duplicate" } },
          { key: "", fields: { summary: "Missing key" } },
        ],
      }),
    });

    const issues = await searchIssuesAssignedToCurrentUser(client, { maxIssues: 50 });

    expect(issues).toEqual([{ issueKey: "ABC-1", summary: "One", status: "Open" }]);
    expect(client.post).toHaveBeenCalledWith(
      "/rest/api/3/search/jql",
      expect.objectContaining({
        jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
      }),
    );
  });

  it("falls back to legacy search when modern JQL endpoint is unavailable", async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValueOnce(new JiraNotFoundError())
        .mockResolvedValueOnce({
          total: 1,
          issues: [{ key: "ABC-1", fields: { summary: null, status: null } }],
        }),
    });

    const issues = await searchIssuesWithUserWorklogsInRange(
      client,
      "2026-05-04",
      "2026-05-10",
    );

    expect(issues).toEqual([{ issueKey: "ABC-1", summary: null, status: null }]);
    expect(client.post).toHaveBeenNthCalledWith(
      2,
      "/rest/api/3/search",
      expect.objectContaining({
        jql:
          'worklogAuthor = currentUser() AND worklogDate >= "2026-05-04" ' +
          'AND worklogDate <= "2026-05-10"',
        startAt: 0,
      }),
    );
  });
});
