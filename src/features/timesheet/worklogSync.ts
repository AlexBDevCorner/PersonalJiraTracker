import {
  createJiraClientFromSettings,
  createJiraWorklog,
  deleteJiraWorklog,
  fetchCurrentJiraUser,
  fetchJiraWorklogsForIssue,
  formatJiraError,
  JiraConfigError,
  searchIssuesWithUserWorklogsInRange,
  updateJiraWorklog,
  JiraNotFoundError,
  type JiraClient,
  type JiraWorklogItem,
} from "../../jira";
import { getJiraCredentials } from "../settings/settingsRepo";
import { upsertDiscoveredIssue } from "../issues/issuesRepo";
import { log } from "../../log";
import {
  getCachedAccountId,
  makeAccountIdCacheKey,
  setCachedAccountId,
} from "./accountIdCache";
import {
  incrementWorklogSubmitAttempt,
  listDeletedWorklogs,
  listDraftWorklogs,
  listModifiedWorklogs,
  markWorklogSubmitted,
  markWorklogUpdateSubmitted,
  mergeJiraWorklog,
  reconcileRemovedWorklogs,
  removeWorklogLocally,
  type WorklogEntry,
} from "./worklogsRepo";

export type SubmitFailure = {
  entry: WorklogEntry;
  message: string;
};

export type SubmitDraftsResult = {
  created: number;
  failures: SubmitFailure[];
};

export async function submitDraftWorklogs(
  drafts?: WorklogEntry[],
): Promise<SubmitDraftsResult> {
  const targets = drafts ?? (await listDraftWorklogs());
  if (targets.length === 0) {
    return { created: 0, failures: [] };
  }

  const client = await createJiraClientFromSettings();
  const accountId = await resolveAccountId(client);
  const failures: SubmitFailure[] = [];
  let created = 0;
  let recovered = 0;
  // Cache remote lookups by issue+date so a batch with several retries on the
  // same cell doesn't hit Jira repeatedly.
  const remoteCache = new Map<string, JiraWorklogItem[]>();

  for (const entry of targets) {
    try {
      // Recovery path: a previous attempt may have created a worklog in Jira
      // even though the response failed. Adopt that worklog instead of
      // creating a duplicate.
      if (entry.submitAttempts > 0) {
        const adopted = await tryAdoptOrphanedWorklog(
          client,
          accountId,
          entry,
          remoteCache,
        );
        if (adopted) {
          recovered += 1;
          continue;
        }
      }

      await incrementWorklogSubmitAttempt(entry.id);
      const result = await createJiraWorklog(client, {
        issueKey: entry.issueKey,
        isoDate: entry.date,
        timeSpentHours: entry.timeSpentHours,
        comment: entry.comment,
      });
      await markWorklogSubmitted(entry.id, result.id);
      created += 1;
    } catch (cause) {
      const message = formatJiraError(cause, { action: "Submit worklog" });
      log.error(`Submit draft failed for ${entry.issueKey} ${entry.date}`, cause);
      failures.push({ entry, message });
    }
  }

  return { created: created + recovered, failures };
}

const HOURS_MATCH_TOLERANCE = 1 / 3600; // one second of work-time precision.

async function tryAdoptOrphanedWorklog(
  client: JiraClient,
  accountId: string | null,
  entry: WorklogEntry,
  cache: Map<string, JiraWorklogItem[]>,
): Promise<boolean> {
  const cacheKey = `${entry.issueKey}|${entry.date}`;
  let remote = cache.get(cacheKey);
  if (!remote) {
    remote = await fetchJiraWorklogsForIssue(
      client,
      entry.issueKey,
      entry.date,
      entry.date,
    );
    cache.set(cacheKey, remote);
  }
  const trimmedComment = entry.comment.trim();
  const match = remote.find((item) => {
    if (item.isoDate !== entry.date) return false;
    if (accountId && item.authorAccountId && item.authorAccountId !== accountId) {
      return false;
    }
    if (Math.abs(item.timeSpentHours - entry.timeSpentHours) > HOURS_MATCH_TOLERANCE) {
      return false;
    }
    if (item.comment.trim() !== trimmedComment) return false;
    return true;
  });
  if (!match) return false;
  await markWorklogSubmitted(entry.id, match.id);
  // Drop from the cache so a second draft with identical fingerprint cannot
  // adopt the same remote worklog.
  cache.set(
    cacheKey,
    remote.filter((item) => item.id !== match.id),
  );
  return true;
}

export type SubmitModifiedResult = {
  updated: number;
  failures: SubmitFailure[];
};

export async function submitModifiedWorklogs(
  modified?: WorklogEntry[],
): Promise<SubmitModifiedResult> {
  const targets = modified ?? (await listModifiedWorklogs());
  if (targets.length === 0) {
    return { updated: 0, failures: [] };
  }

  const failures: SubmitFailure[] = [];
  const sendable: WorklogEntry[] = [];
  for (const entry of targets) {
    if (!entry.jiraWorklogId) {
      failures.push({
        entry,
        message: "Cannot update entry without a Jira worklog ID.",
      });
      continue;
    }
    sendable.push(entry);
  }

  if (sendable.length === 0) {
    return { updated: 0, failures };
  }

  const client = await createJiraClientFromSettings();
  let updated = 0;

  for (const entry of sendable) {
    try {
      await updateJiraWorklog(client, {
        issueKey: entry.issueKey,
        jiraWorklogId: entry.jiraWorklogId as string,
        isoDate: entry.date,
        timeSpentHours: entry.timeSpentHours,
        comment: entry.comment,
      });
      await markWorklogUpdateSubmitted(entry.id);
      updated += 1;
    } catch (cause) {
      const message = formatJiraError(cause, { action: "Update worklog" });
      log.error(`Update worklog failed for ${entry.issueKey} ${entry.date}`, cause);
      failures.push({ entry, message });
    }
  }

  return { updated, failures };
}

export type SubmitDeletedResult = {
  deleted: number;
  failures: SubmitFailure[];
};

export async function submitDeletedWorklogs(
  deleted?: WorklogEntry[],
): Promise<SubmitDeletedResult> {
  const targets = deleted ?? (await listDeletedWorklogs());
  if (targets.length === 0) {
    return { deleted: 0, failures: [] };
  }

  const failures: SubmitFailure[] = [];
  const sendable: WorklogEntry[] = [];
  for (const entry of targets) {
    if (!entry.jiraWorklogId) {
      // Never reached Jira; safe to drop locally without a remote call.
      await removeWorklogLocally(entry.id);
      continue;
    }
    sendable.push(entry);
  }

  if (sendable.length === 0) {
    return { deleted: targets.length - failures.length, failures };
  }

  const client = await createJiraClientFromSettings();
  let deletedCount = targets.length - sendable.length - failures.length;

  for (const entry of sendable) {
    try {
      await deleteJiraWorklog(client, {
        issueKey: entry.issueKey,
        jiraWorklogId: entry.jiraWorklogId as string,
      });
      await removeWorklogLocally(entry.id);
      deletedCount += 1;
    } catch (cause) {
      // If Jira already lost the worklog, treat it as deleted so the user
      // isn't stuck retrying a row that no longer exists upstream.
      if (cause instanceof JiraNotFoundError) {
        await removeWorklogLocally(entry.id);
        deletedCount += 1;
        continue;
      }
      const message = formatJiraError(cause, { action: "Delete worklog" });
      log.error(`Delete worklog failed for ${entry.issueKey} ${entry.date}`, cause);
      failures.push({ entry, message });
    }
  }

  return { deleted: deletedCount, failures };
}

export type FetchFailure = {
  issueKey: string;
  message: string;
};

export type DiscoveredIssue = {
  issueKey: string;
  summary: string | null;
  status: string | null;
};

export type SyncWeekResult = {
  imported: number;
  updated: number;
  preserved: number;
  removed: number;
  failures: FetchFailure[];
  discoveredIssues: DiscoveredIssue[];
  discoveryFailed: boolean;
};

async function resolveAccountId(client: JiraClient): Promise<string | null> {
  const credentials = await getJiraCredentials();
  if (!credentials) return null;
  const key = makeAccountIdCacheKey(credentials.baseUrl, credentials.email);
  const hit = getCachedAccountId(key);
  if (hit !== null) return hit;
  try {
    const user = await fetchCurrentJiraUser(client);
    const accountId = user.accountId || null;
    if (accountId) setCachedAccountId(key, accountId);
    return accountId;
  } catch {
    return null;
  }
}

export async function syncWeekFromJira(
  startIsoDate: string,
  endIsoDate: string,
  issueKeys: readonly string[],
): Promise<SyncWeekResult> {
  const client = await createJiraClientFromSettings();
  const accountId = await resolveAccountId(client);
  if (!accountId) {
    // Fail closed: without a confirmed identity for the current credentials we
    // cannot tell which remote worklogs are ours, and reconcileRemovedWorklogs
    // would happily delete local rows that simply belong to a different user.
    throw new JiraConfigError(
      "Could not resolve the Jira account for the current credentials. " +
        "Open Settings to verify the email and API token before syncing.",
    );
  }

  // Discover every issue the signed-in user logged time on in the visible week,
  // not just the ones they pinned as favorites. Without this, time logged in
  // Jira against an unpinned issue would never reach the grid.
  const discoveredIssues: DiscoveredIssue[] = [];
  let discoveryFailed = false;
  try {
    const discovered = await searchIssuesWithUserWorklogsInRange(
      client,
      startIsoDate,
      endIsoDate,
    );
    for (const issue of discovered) {
      discoveredIssues.push({
        issueKey: issue.issueKey,
        summary: issue.summary,
        status: issue.status,
      });
      try {
        await upsertDiscoveredIssue(issue.issueKey, issue.summary, issue.status);
      } catch (cause) {
        log.error(`Cache discovered issue ${issue.issueKey} failed`, cause);
      }
    }
  } catch (cause) {
    discoveryFailed = true;
    log.error("Discover Jira worklog issues failed", cause);
  }

  const allKeys = new Set<string>();
  for (const key of issueKeys) allKeys.add(key);
  for (const issue of discoveredIssues) allKeys.add(issue.issueKey);

  if (allKeys.size === 0) {
    return {
      imported: 0,
      updated: 0,
      preserved: 0,
      removed: 0,
      failures: [],
      discoveredIssues,
      discoveryFailed,
    };
  }

  let imported = 0;
  let updated = 0;
  let preserved = 0;
  let removed = 0;
  const failures: FetchFailure[] = [];

  for (const issueKey of allKeys) {
    try {
      const items = await fetchJiraWorklogsForIssue(
        client,
        issueKey,
        startIsoDate,
        endIsoDate,
      );
      const remoteIds = new Set<string>();
      for (const item of items) {
        if (accountId && item.authorAccountId && item.authorAccountId !== accountId) {
          // Only the signed-in user's worklogs belong on their timesheet.
          continue;
        }
        remoteIds.add(item.id);
        const result = await mergeJiraWorklog({
          issueKey: item.issueKey,
          jiraWorklogId: item.id,
          isoDate: item.isoDate,
          timeSpentHours: item.timeSpentHours,
          comment: item.comment,
        });
        if (result === "inserted") imported += 1;
        else if (result === "updated") updated += 1;
        else preserved += 1;
      }
      removed += await reconcileRemovedWorklogs(
        issueKey,
        startIsoDate,
        endIsoDate,
        remoteIds,
      );
    } catch (cause) {
      const message = formatJiraError(cause, { action: "Fetch worklogs" });
      log.error(`Fetch worklogs failed for ${issueKey}`, cause);
      failures.push({ issueKey, message });
    }
  }

  return {
    imported,
    updated,
    preserved,
    removed,
    failures,
    discoveredIssues,
    discoveryFailed,
  };
}

export type HydrateIssueResult = {
  imported: number;
  updated: number;
  preserved: number;
  removed: number;
  failed: boolean;
  message?: string;
};

export async function hydrateIssueForWeek(
  issueKey: string,
  startIsoDate: string,
  endIsoDate: string,
): Promise<HydrateIssueResult> {
  // Targeted single-issue refresh used when the user picks a ticket onto the
  // current week — avoids paying the JQL discovery cost just to surface one
  // ticket's pre-existing Jira time.
  const client = await createJiraClientFromSettings();
  const accountId = await resolveAccountId(client);
  let imported = 0;
  let updated = 0;
  let preserved = 0;
  let removed = 0;
  if (!accountId) {
    return {
      imported,
      updated,
      preserved,
      removed,
      failed: true,
      message:
        "Could not resolve the Jira account for the current credentials. " +
        "Open Settings to verify the email and API token before syncing.",
    };
  }
  try {
    const items = await fetchJiraWorklogsForIssue(
      client,
      issueKey,
      startIsoDate,
      endIsoDate,
    );
    const remoteIds = new Set<string>();
    for (const item of items) {
      if (accountId && item.authorAccountId && item.authorAccountId !== accountId) {
        continue;
      }
      remoteIds.add(item.id);
      const result = await mergeJiraWorklog({
        issueKey: item.issueKey,
        jiraWorklogId: item.id,
        isoDate: item.isoDate,
        timeSpentHours: item.timeSpentHours,
        comment: item.comment,
      });
      if (result === "inserted") imported += 1;
      else if (result === "updated") updated += 1;
      else preserved += 1;
    }
    removed = await reconcileRemovedWorklogs(
      issueKey,
      startIsoDate,
      endIsoDate,
      remoteIds,
    );
    return { imported, updated, preserved, removed, failed: false };
  } catch (cause) {
    const message = formatJiraError(cause, { action: "Fetch worklogs" });
    log.error(`Fetch worklogs failed for ${issueKey}`, cause);
    return { imported, updated, preserved, removed, failed: true, message };
  }
}

export type SubmitAllResult = {
  created: number;
  updated: number;
  deleted: number;
  failures: SubmitFailure[];
};

export async function submitAllPending(): Promise<SubmitAllResult> {
  // Order matches REQ-SYNC-002: create drafts, update modified, delete deleted.
  // Each phase is independent — a failure in one does not prevent the next.
  const drafts = await submitDraftWorklogs();
  const modified = await submitModifiedWorklogs();
  const deleted = await submitDeletedWorklogs();
  return {
    created: drafts.created,
    updated: modified.updated,
    deleted: deleted.deleted,
    failures: [...drafts.failures, ...modified.failures, ...deleted.failures],
  };
}
