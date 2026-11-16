import { describe, expect, it, vi } from "vitest";
import { JiraForbiddenError, type JiraClient } from "../../jira";
import { fetchBoard, moveBoardIssue } from "./boardApi";

function client(overrides: Partial<JiraClient> = {}): JiraClient {
  return { request: vi.fn(), get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), ...overrides };
}

const open = { id: "1", name: "Open", statusCategory: { key: "new" } };
const active = { id: "2", name: "In progress", statusCategory: { key: "indeterminate" } };
const done = { id: "3", name: "Done", statusCategory: { key: "done" } };

function issue(key: string, project = "APP", type = "task", status = open) {
  return { key, fields: { summary: `Title ${key}`, status, project: { key: project }, issuetype: { id: type } } };
}

describe("personal board", () => {
  it("loads all assigned tickets across pages, including completed tickets, without the sidebar's 50-ticket cap", async () => {
    const jira = client({
      post: vi.fn()
        .mockResolvedValueOnce({ issues: Array.from({ length: 60 }, (_, i) => issue(`APP-${i + 1}`)), nextPageToken: "page-2" })
        .mockResolvedValueOnce({ issues: [issue("APP-1"), issue("APP-61", "APP", "task", done)], isLast: true }),
      get: vi.fn().mockResolvedValue([{ id: "task", statuses: [done, open, active] }]),
    });

    const board = await fetchBoard(jira);

    expect(board.issues).toHaveLength(61);
    expect(board.issues[60].status).toEqual(done);
    expect(board.statuses).toEqual([open, active, done]);
    expect(jira.post).toHaveBeenNthCalledWith(2, "/rest/api/3/search/jql", {
      jql: "assignee = currentUser() ORDER BY updated DESC",
      fields: ["summary", "status", "project", "issuetype"],
      maxResults: 100,
      nextPageToken: "page-2",
    });
    expect(jira.get).toHaveBeenCalledTimes(1);
  });

  it("uses the issue types of each project and keeps distinct status IDs with identical names", async () => {
    const otherOpen = { ...open, id: "99" };
    const jira = client({
      post: vi.fn().mockResolvedValue({ issues: [issue("APP-1"), issue("WEB-1", "WEB", "bug", otherOpen)], isLast: true }),
      get: vi.fn().mockImplementation(async (path: string) => path.includes("/APP/")
        ? [{ id: "task", statuses: [open, active, done] }, { id: "unrelated", statuses: [{ id: "100", name: "Unrelated" }] }]
        : [{ id: "bug", statuses: [otherOpen, done] }]),
    });

    const board = await fetchBoard(jira);

    expect(board.statuses.map((status) => status.id)).toEqual(["1", "99", "2", "3"]);
    expect(jira.get).toHaveBeenCalledTimes(2);
  });

  it("does not request workflows when no tickets are assigned", async () => {
    const jira = client({ post: vi.fn().mockResolvedValue({ issues: [], isLast: true }) });
    await expect(fetchBoard(jira)).resolves.toEqual({ issues: [], statuses: [] });
    expect(jira.get).not.toHaveBeenCalled();
  });

  it("reports incomplete Jira ticket data instead of silently hiding tickets", async () => {
    const jira = client({ post: vi.fn().mockResolvedValue({ issues: [{ key: "APP-1", fields: { summary: "Incomplete" } }], isLast: true }) });
    await expect(fetchBoard(jira)).rejects.toThrow("without its status or workflow details");
  });

  it("surfaces workflow discovery failures", async () => {
    const jira = client({
      post: vi.fn().mockResolvedValue({ issues: [issue("APP-1")], isLast: true }),
      get: vi.fn().mockRejectedValue(new JiraForbiddenError()),
    });
    await expect(fetchBoard(jira)).rejects.toThrow(JiraForbiddenError);
  });
});

describe("moving a board ticket", () => {
  it("uses a fresh permitted transition ID, not the destination status ID", async () => {
    const jira = client({ get: vi.fn().mockResolvedValue({ transitions: [{ id: "transition-31", to: active }] }) });

    await expect(moveBoardIssue(jira, " app-1 ", "2")).resolves.toEqual(active);

    expect(jira.get).toHaveBeenCalledWith("/rest/api/3/issue/APP-1/transitions", { expand: "transitions.fields" });
    expect(jira.post).toHaveBeenCalledWith("/rest/api/3/issue/APP-1/transitions", { transition: { id: "transition-31" } });
  });

  it.each([
    { transitions: [], message: "cannot move directly" },
    { transitions: [{ id: "31", to: done, isAvailable: false }], message: "cannot move directly" },
    { transitions: [{ id: "31", to: done }, { id: "32", to: done }], message: "multiple actions" },
    { transitions: [{ id: "31", to: done, fields: { resolution: { required: true, hasDefaultValue: false } } }], message: "requires additional fields" },
  ])("does not submit a move that $message", async ({ transitions, message }) => {
    const jira = client({ get: vi.fn().mockResolvedValue({ transitions }) });
    await expect(moveBoardIssue(jira, "APP-1", "3")).rejects.toThrow(message);
    expect(jira.post).not.toHaveBeenCalled();
  });

  it("allows Jira to supply configured defaults for required fields", async () => {
    const jira = client({ get: vi.fn().mockResolvedValue({ transitions: [{
      id: "31", to: done, fields: { resolution: { required: true, hasDefaultValue: true } },
    }] }) });
    await expect(moveBoardIssue(jira, "APP-1", "3")).resolves.toEqual(done);
  });

  it("propagates a rejected save without retrying or reporting a successful move", async () => {
    const jira = client({
      get: vi.fn().mockResolvedValue({ transitions: [{ id: "31", to: active }] }),
      post: vi.fn().mockRejectedValue(new JiraForbiddenError()),
    });
    await expect(moveBoardIssue(jira, "APP-1", "2")).rejects.toThrow(JiraForbiddenError);
    expect(jira.post).toHaveBeenCalledTimes(1);
  });
});
