import { getJiraCredentials } from "../features/settings/settingsRepo";
import { createJiraClient, type JiraClient } from "./client";
import { JiraConfigError, JiraNotFoundError } from "./errors";
import { composeIssueUrl as composeIssueUrlImpl } from "./issueUrl";

export { createJiraClient } from "./client";
export type {
  JiraClient,
  JiraCredentials,
  JiraRequestOptions,
} from "./client";
export {
  JiraError,
  JiraConfigError,
  JiraNetworkError,
  JiraAuthError,
  JiraForbiddenError,
  JiraNotFoundError,
  JiraApiError,
} from "./errors";
export type { JiraErrorKind } from "./errors";
export { formatJiraError } from "./format";
export type { JiraErrorContext } from "./format";
export { composeIssueUrl, isSafeIssueUrl } from "./issueUrl";
export { openIssueInBrowser } from "./openIssue";

export async function createJiraClientFromSettings(): Promise<JiraClient> {
  const credentials = await getJiraCredentials();
  if (!credentials) {
    throw new JiraConfigError(
      "Jira credentials are not configured. Open Settings to add a base URL, email, and API token.",
    );
  }
  return createJiraClient(credentials);
}

export type JiraCurrentUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
};

type MyselfResponse = {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
};

export async function fetchCurrentJiraUser(client: JiraClient): Promise<JiraCurrentUser> {
  const body = await client.get<MyselfResponse>("/rest/api/3/myself");
  return {
    accountId: body?.accountId ?? "",
    displayName: body?.displayName ?? "Jira user",
    emailAddress: body?.emailAddress,
  };
}

export async function testJiraConnection(): Promise<JiraCurrentUser> {
  const client = await createJiraClientFromSettings();
  return fetchCurrentJiraUser(client);
}

export type JiraIssue = {
  issueKey: string;
  summary: string | null;
  status: string | null;
  url: string;
};

type IssueResponse = {
  key?: string;
  fields?: {
    summary?: string | null;
    status?: { name?: string | null } | null;
  } | null;
};

const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/;

export function normalizeIssueKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidIssueKey(raw: string): boolean {
  return ISSUE_KEY_PATTERN.test(normalizeIssueKey(raw));
}

export async function lookupJiraIssue(issueKey: string): Promise<JiraIssue> {
  const credentials = await getJiraCredentials();
  if (!credentials) {
    throw new JiraConfigError(
      "Jira credentials are not configured. Open Settings to add a base URL, email, and API token.",
    );
  }
  const client = createJiraClient(credentials);
  const key = normalizeIssueKey(issueKey);
  const body = await client.get<IssueResponse>(
    `/rest/api/3/issue/${encodeURIComponent(key)}`,
    { fields: "summary,status" },
  );
  const resolvedKey = body?.key ?? key;
  return {
    issueKey: resolvedKey,
    summary: body?.fields?.summary ?? null,
    status: body?.fields?.status?.name ?? null,
    url: composeIssueUrlImpl(credentials.baseUrl, resolvedKey),
  };
}

export type CreateJiraWorklogInput = {
  issueKey: string;
  isoDate: string;
  timeSpentHours: number;
  comment: string;
};

export type CreatedJiraWorklog = {
  id: string;
};

type WorklogResponse = {
  id?: string | number;
};

export async function createJiraWorklog(
  client: JiraClient,
  input: CreateJiraWorklogInput,
): Promise<CreatedJiraWorklog> {
  const key = normalizeIssueKey(input.issueKey);
  const body = await client.post<WorklogResponse>(
    `/rest/api/3/issue/${encodeURIComponent(key)}/worklog`,
    {
      started: formatJiraStarted(input.isoDate),
      timeSpentSeconds: hoursToSeconds(input.timeSpentHours),
      comment: toAdf(input.comment),
    },
  );
  const rawId = body?.id;
  if (rawId === undefined || rawId === null || String(rawId).length === 0) {
    throw new Error("Jira accepted the worklog but did not return an ID.");
  }
  return { id: String(rawId) };
}

export type UpdateJiraWorklogInput = {
  issueKey: string;
  jiraWorklogId: string;
  isoDate: string;
  timeSpentHours: number;
  comment: string;
};

export async function updateJiraWorklog(
  client: JiraClient,
  input: UpdateJiraWorklogInput,
): Promise<void> {
  const key = normalizeIssueKey(input.issueKey);
  const worklogId = input.jiraWorklogId.trim();
  if (!worklogId) {
    throw new Error("Jira worklog ID is required to update a worklog.");
  }
  await client.put(
    `/rest/api/3/issue/${encodeURIComponent(key)}/worklog/${encodeURIComponent(worklogId)}`,
    {
      started: formatJiraStarted(input.isoDate),
      timeSpentSeconds: hoursToSeconds(input.timeSpentHours),
      comment: toAdf(input.comment),
    },
  );
}

export type JiraWorklogItem = {
  id: string;
  issueKey: string;
  isoDate: string;
  timeSpentHours: number;
  comment: string;
  authorAccountId: string | null;
};

type WorklogItemResponse = {
  id?: string | number;
  started?: string;
  timeSpentSeconds?: number;
  comment?: unknown;
  author?: { accountId?: string | null } | null;
};

type WorklogListResponse = {
  startAt?: number;
  maxResults?: number;
  total?: number;
  worklogs?: WorklogItemResponse[];
};

type JqlSearchIssue = {
  key?: string;
  fields?: {
    summary?: string | null;
    status?: { name?: string | null } | null;
  } | null;
};

type JqlSearchResponse = {
  issues?: JqlSearchIssue[];
  nextPageToken?: string;
  isLast?: boolean;
  total?: number;
  startAt?: number;
  maxResults?: number;
};

export type JiraIssueSummary = {
  issueKey: string;
  summary: string | null;
  status: string | null;
};

async function searchIssuesByJql(
  client: JiraClient,
  jql: string,
  options: { maxIssues?: number } = {},
): Promise<JiraIssueSummary[]> {
  const maxIssues = options.maxIssues ?? Infinity;
  const issues = new Map<string, JiraIssueSummary>();

  let nextPageToken: string | undefined;
  let useLegacy = false;
  let legacyStartAt = 0;
  for (;;) {
    let body: JqlSearchResponse;
    if (!useLegacy) {
      try {
        body = await client.post<JqlSearchResponse>("/rest/api/3/search/jql", {
          jql,
          fields: ["summary", "status"],
          maxResults: 100,
          ...(nextPageToken ? { nextPageToken } : {}),
        });
      } catch (cause) {
        // Self-hosted instances may not expose /search/jql yet — fall back
        // to the legacy /search endpoint with offset paging.
        if (cause instanceof JiraNotFoundError) {
          useLegacy = true;
          continue;
        }
        throw cause;
      }
    } else {
      body = await client.post<JqlSearchResponse>("/rest/api/3/search", {
        jql,
        fields: ["summary", "status"],
        maxResults: 100,
        startAt: legacyStartAt,
      });
    }

    const items = body?.issues ?? [];
    for (const item of items) {
      const key = typeof item?.key === "string" ? item.key : "";
      if (!key) continue;
      if (issues.has(key)) continue;
      issues.set(key, {
        issueKey: key,
        summary: item?.fields?.summary ?? null,
        status: item?.fields?.status?.name ?? null,
      });
      if (issues.size >= maxIssues) return [...issues.values()];
    }

    if (useLegacy) {
      const total =
        typeof body?.total === "number" ? body.total : legacyStartAt + items.length;
      legacyStartAt += items.length;
      if (items.length === 0 || legacyStartAt >= total) break;
    } else {
      if (body?.isLast === true) break;
      if (!body?.nextPageToken) break;
      nextPageToken = body.nextPageToken;
    }
  }

  return [...issues.values()];
}

export async function searchIssuesWithUserWorklogsInRange(
  client: JiraClient,
  startIsoDate: string,
  endIsoDateInclusive: string,
): Promise<JiraIssueSummary[]> {
  const jql =
    `worklogAuthor = currentUser() ` +
    `AND worklogDate >= "${startIsoDate}" ` +
    `AND worklogDate <= "${endIsoDateInclusive}"`;
  return searchIssuesByJql(client, jql);
}

export async function searchIssuesAssignedToCurrentUser(
  client: JiraClient,
  options: { maxIssues?: number } = {},
): Promise<JiraIssueSummary[]> {
  const jql =
    `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`;
  return searchIssuesByJql(client, jql, { maxIssues: options.maxIssues ?? 50 });
}

export async function fetchJiraWorklogsForIssue(
  client: JiraClient,
  issueKey: string,
  startIsoDate: string,
  endIsoDateInclusive: string,
): Promise<JiraWorklogItem[]> {
  const key = normalizeIssueKey(issueKey);
  const startMs = isoDateToLocalEpochMs(startIsoDate, 0);
  // Jira's startedBefore is exclusive; pass start-of-next-day after the
  // inclusive end so worklogs on the last day are returned.
  const endMs = isoDateToLocalEpochMs(endIsoDateInclusive, 1);

  const collected: JiraWorklogItem[] = [];
  let startAt = 0;
  for (;;) {
    const body = await client.get<WorklogListResponse>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/worklog`,
      {
        startedAfter: startMs,
        startedBefore: endMs,
        startAt,
      },
    );
    const items = body?.worklogs ?? [];
    for (const item of items) {
      const parsed = parseWorklogItem(item, key);
      if (parsed) collected.push(parsed);
    }
    const total = typeof body?.total === "number" ? body.total : collected.length;
    const pageSize = items.length;
    if (pageSize === 0) break;
    startAt += pageSize;
    if (startAt >= total) break;
  }
  return collected;
}

function parseWorklogItem(
  item: WorklogItemResponse,
  issueKey: string,
): JiraWorklogItem | null {
  const rawId = item?.id;
  if (rawId === undefined || rawId === null || String(rawId).length === 0) {
    return null;
  }
  const started = typeof item.started === "string" ? item.started : null;
  if (!started) return null;
  const isoDate = startedToIsoDate(started);
  if (!isoDate) return null;
  const seconds = typeof item.timeSpentSeconds === "number" ? item.timeSpentSeconds : 0;
  return {
    id: String(rawId),
    issueKey,
    isoDate,
    timeSpentHours: seconds / 3600,
    comment: extractAdfText(item.comment),
    authorAccountId: item.author?.accountId ?? null,
  };
}

function isoDateToLocalEpochMs(isoDate: string, dayOffset: number): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, (d ?? 1) + dayOffset, 0, 0, 0, 0).getTime();
}

function startedToIsoDate(started: string): string | null {
  const date = new Date(started);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function extractAdfText(comment: unknown): string {
  if (comment == null) return "";
  if (typeof comment === "string") return comment;
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "text" && typeof obj.text === "string") {
      parts.push(obj.text);
      return;
    }
    const content = obj.content;
    if (Array.isArray(content)) {
      for (const child of content) visit(child);
    }
  };
  visit(comment);
  return parts.join("").trim();
}

export type DeleteJiraWorklogInput = {
  issueKey: string;
  jiraWorklogId: string;
};

export async function deleteJiraWorklog(
  client: JiraClient,
  input: DeleteJiraWorklogInput,
): Promise<void> {
  const key = normalizeIssueKey(input.issueKey);
  const worklogId = input.jiraWorklogId.trim();
  if (!worklogId) {
    throw new Error("Jira worklog ID is required to delete a worklog.");
  }
  await client.delete(
    `/rest/api/3/issue/${encodeURIComponent(key)}/worklog/${encodeURIComponent(worklogId)}`,
  );
}

function hoursToSeconds(hours: number): number {
  return Math.round(hours * 3600);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatJiraStarted(isoDate: string): string {
  // Jira requires an ISO 8601 timestamp with a numeric timezone offset
  // (e.g. "2025-05-01T09:00:00.000+0000"). Use 09:00 local time on the
  // worklog date so "started" lands on the day the user picked regardless
  // of the runtime's UTC offset.
  const [y, m, d] = isoDate.split("-").map(Number);
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, 9, 0, 0, 0);
  const offsetMinutes = -local.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absMinutes / 60))}${pad2(absMinutes % 60)}`;
  return (
    `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}` +
    `T${pad2(local.getHours())}:${pad2(local.getMinutes())}:${pad2(local.getSeconds())}.000${offset}`
  );
}

function toAdf(comment: string) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: comment }],
      },
    ],
  };
}
