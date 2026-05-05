import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, selectOne } from "../../db";
import {
  getJiraCredentials,
  getSettings,
  JIRA_API_TOKEN_REF,
  saveSettings,
} from "./settingsRepo";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../db", () => ({
  execute: vi.fn(),
  selectOne: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const invokeMock = vi.mocked(invoke);
const selectOneMock = vi.mocked(selectOne);

describe("settingsRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1 });
    invokeMock.mockResolvedValue(JIRA_API_TOKEN_REF);
  });

  it("maps persisted settings and token presence", async () => {
    selectOneMock.mockResolvedValue({
      jira_base_url: "https://example.atlassian.net",
      email: "person@example.com",
      api_token_ref: JIRA_API_TOKEN_REF,
      updated_at: "2026-05-05",
    });

    const settings = await getSettings();

    expect(settings).toEqual({
      jiraBaseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      hasApiToken: true,
      updatedAt: "2026-05-05",
    });
  });

  it("returns empty settings when the singleton row is missing", async () => {
    selectOneMock.mockResolvedValue(null);

    await expect(getSettings()).resolves.toEqual({
      jiraBaseUrl: null,
      email: null,
      hasApiToken: false,
      updatedAt: null,
    });
  });

  it("returns credentials only when every required field exists", async () => {
    selectOneMock
      .mockResolvedValueOnce({
        jira_base_url: "https://example.atlassian.net",
        email: "person@example.com",
        api_token_ref: JIRA_API_TOKEN_REF,
        updated_at: "2026-05-05",
      })
      .mockResolvedValueOnce({
        jira_base_url: "https://example.atlassian.net",
        email: "person@example.com",
        api_token_ref: null,
        updated_at: "2026-05-05",
      });

    await expect(getJiraCredentials()).resolves.toEqual({
      baseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiTokenRef: JIRA_API_TOKEN_REF,
    });
    await expect(getJiraCredentials()).resolves.toBeNull();
  });

  it("saves a trimmed token when a new token is provided", async () => {
    await saveSettings({
      jiraBaseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiToken: "  token  ",
    });

    expect(executeMock).toHaveBeenCalledWith(
      "UPDATE settings SET jira_base_url = ?, email = ?, api_token_ref = ?, updated_at = datetime('now') WHERE id = 1",
      ["https://example.atlassian.net", "person@example.com", JIRA_API_TOKEN_REF],
    );
    expect(invokeMock).toHaveBeenCalledWith("save_jira_api_token", {
      token: "token",
    });
  });

  it("preserves the existing token when token input is blank", async () => {
    await saveSettings({
      jiraBaseUrl: "https://example.atlassian.net",
      email: "person@example.com",
      apiToken: " ",
    });

    expect(executeMock).toHaveBeenCalledWith(
      "UPDATE settings SET jira_base_url = ?, email = ?, updated_at = datetime('now') WHERE id = 1",
      ["https://example.atlassian.net", "person@example.com"],
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

});
