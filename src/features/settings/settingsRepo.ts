import { invoke } from "@tauri-apps/api/core";
import { execute, selectOne } from "../../db";
import { invalidateAccountIdCache } from "../timesheet/accountIdCache";

export const JIRA_API_TOKEN_REF = "jira:default";

export type Settings = {
  jiraBaseUrl: string | null;
  email: string | null;
  hasApiToken: boolean;
  updatedAt: string | null;
};

export type SaveSettingsInput = {
  jiraBaseUrl: string;
  email: string;
  apiToken?: string;
};

export type JiraCredentials = {
  baseUrl: string;
  email: string;
  apiTokenRef: string;
};

type SettingsRow = {
  jira_base_url: string | null;
  email: string | null;
  api_token_ref: string | null;
  updated_at: string | null;
};

export async function getSettings(): Promise<Settings> {
  const row = await getSettingsRow();
  return {
    jiraBaseUrl: row?.jira_base_url ?? null,
    email: row?.email ?? null,
    hasApiToken: Boolean(row?.api_token_ref),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getJiraCredentials(): Promise<JiraCredentials | null> {
  const row = await getSettingsRow();
  if (!row?.jira_base_url || !row.email || !row.api_token_ref) {
    return null;
  }
  return {
    baseUrl: row.jira_base_url,
    email: row.email,
    apiTokenRef: row.api_token_ref,
  };
}

export async function saveSettings(input: SaveSettingsInput): Promise<void> {
  const trimmedToken = input.apiToken?.trim();
  if (trimmedToken && trimmedToken.length > 0) {
    const tokenRef = await saveJiraApiToken(trimmedToken);
    await execute(
      "UPDATE settings SET jira_base_url = ?, email = ?, api_token_ref = ?, updated_at = datetime('now') WHERE id = 1",
      [input.jiraBaseUrl, input.email, tokenRef],
    );
  } else {
    await execute(
      "UPDATE settings SET jira_base_url = ?, email = ?, updated_at = datetime('now') WHERE id = 1",
      [input.jiraBaseUrl, input.email],
    );
  }
  // Credentials may now point at a different Jira account — drop any cached
  // accountId so the next sync re-resolves it against the new identity.
  invalidateAccountIdCache();
}

function getSettingsRow(): Promise<SettingsRow | null> {
  return selectOne<SettingsRow>(
    "SELECT jira_base_url, email, api_token_ref, updated_at FROM settings WHERE id = 1",
  );
}

function saveJiraApiToken(token: string): Promise<string> {
  return invoke<string>("save_jira_api_token", { token });
}
