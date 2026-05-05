import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJiraClient } from "./client";
import { JiraConfigError, JiraForbiddenError, JiraNetworkError } from "./errors";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe("createJiraClient", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("normalizes the base URL and delegates Jira requests to Rust", async () => {
    invokeMock.mockResolvedValue({ ok: true });
    const client = createJiraClient({
      baseUrl: " https://example.atlassian.net/ ",
      email: "person@example.com",
      apiTokenRef: "jira:default",
    });

    const result = await client.post<{ ok: boolean }>(
      "/rest/api/3/issue/ABC-1/worklog",
      { timeSpentSeconds: 3600 },
    );

    expect(result).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("jira_request", {
      request: {
        baseUrl: "https://example.atlassian.net",
        email: "person@example.com",
        apiTokenRef: "jira:default",
        path: "/rest/api/3/issue/ABC-1/worklog",
        method: "POST",
        query: undefined,
        body: { timeSpentSeconds: 3600 },
      },
    });
  });

  it("passes query parameters without exposing an Authorization header", async () => {
    invokeMock.mockResolvedValue({ issues: [] });
    const client = createJiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiTokenRef: "jira:default",
    });

    await client.get("/rest/api/3/search", {
      jql: "project = ABC",
      startAt: 0,
      ignored: undefined,
    });

    expect(invokeMock.mock.calls[0]?.[1]).toEqual({
      request: expect.not.objectContaining({
        headers: expect.anything(),
      }),
    });
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({
      request: {
        query: {
          jql: "project = ABC",
          startAt: 0,
          ignored: undefined,
        },
      },
    });
  });

  it("returns null for no-content responses", async () => {
    invokeMock.mockResolvedValue(null);
    const client = createJiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiTokenRef: "jira:default",
    });

    await expect(client.delete("/rest/api/3/issue/ABC-1/worklog/5")).resolves.toBeNull();
  });

  it("throws a config error for invalid base URLs", () => {
    expect(() =>
      createJiraClient({
        baseUrl: "ftp://example.com",
        email: "person@example.com",
        apiTokenRef: "jira:default",
      }),
    ).toThrow(JiraConfigError);
  });

  it("maps failed fetches to network errors", async () => {
    invokeMock.mockRejectedValue({
      kind: "network",
      message: "Could not reach Jira: connection refused",
    });
    const client = createJiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiTokenRef: "jira:default",
    });

    await expect(client.get("/rest/api/3/myself")).rejects.toBeInstanceOf(
      JiraNetworkError,
    );
  });

  it("maps non-success responses to typed Jira API errors", async () => {
    invokeMock.mockRejectedValue({
      kind: "forbidden",
      status: 403,
      message: "Forbidden issue",
      body: { errorMessages: ["Forbidden issue"] },
    });
    const client = createJiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiTokenRef: "jira:default",
    });

    await expect(client.get("/rest/api/3/issue/ABC-1")).rejects.toBeInstanceOf(
      JiraForbiddenError,
    );
  });
});
