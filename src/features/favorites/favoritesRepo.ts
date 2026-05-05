import { execute, select, selectOne } from "../../db";

export type FavoriteGroup = {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: string;
  issueCount: number;
};

export type FavoriteIssue = {
  id: number;
  groupId: number | null;
  issueKey: string;
  summary: string | null;
  status: string | null;
  url: string | null;
  sortOrder: number;
  createdAt: string;
};

type GroupRow = {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
  issue_count: number;
};

type FavoriteIssueRow = {
  id: number;
  group_id: number | null;
  issue_key: string;
  summary: string | null;
  status: string | null;
  url: string | null;
  sort_order: number;
  created_at: string;
};

export async function listFavoriteGroups(): Promise<FavoriteGroup[]> {
  const rows = await select<GroupRow>(
    "SELECT g.id, g.name, g.sort_order, g.created_at, " +
      "COALESCE((SELECT COUNT(*) FROM favorite_issues fi WHERE fi.group_id = g.id), 0) AS issue_count " +
      "FROM favorite_groups g " +
      "ORDER BY g.sort_order ASC, g.created_at ASC, g.id ASC",
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    issueCount: row.issue_count,
  }));
}

export async function createFavoriteGroup(name: string): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Group name is required.");
  }
  const existing = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_groups WHERE name = ? COLLATE NOCASE",
    [trimmed],
  );
  if (existing) {
    throw new Error(`A group named "${trimmed}" already exists.`);
  }
  const max = await selectOne<{ max_order: number | null }>(
    "SELECT MAX(sort_order) AS max_order FROM favorite_groups",
  );
  const nextOrder = (max?.max_order ?? -1) + 1;
  const result = await execute(
    "INSERT INTO favorite_groups (name, sort_order) VALUES (?, ?)",
    [trimmed, nextOrder],
  );
  return Number(result.lastInsertId ?? 0);
}

export async function renameFavoriteGroup(id: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Group name is required.");
  }
  const conflict = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_groups WHERE name = ? COLLATE NOCASE AND id <> ?",
    [trimmed, id],
  );
  if (conflict) {
    throw new Error(`A group named "${trimmed}" already exists.`);
  }
  await execute("UPDATE favorite_groups SET name = ? WHERE id = ?", [trimmed, id]);
}

export async function deleteFavoriteGroup(id: number): Promise<void> {
  const count = await selectOne<{ c: number }>(
    "SELECT COUNT(*) AS c FROM favorite_issues WHERE group_id = ?",
    [id],
  );
  if ((count?.c ?? 0) > 0) {
    throw new Error("Group is not empty. Remove its issues before deleting.");
  }
  await execute("DELETE FROM favorite_groups WHERE id = ?", [id]);
}

export async function moveFavoriteGroup(id: number, direction: "up" | "down"): Promise<void> {
  const groups = await listFavoriteGroups();
  const index = groups.findIndex((g) => g.id === id);
  if (index === -1) return;
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= groups.length) return;

  const a = groups[index];
  const b = groups[swapIndex];
  if (a.sortOrder === b.sortOrder) {
    await normalizeSortOrders(groups);
    return moveFavoriteGroup(id, direction);
  }
  await execute("UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [b.sortOrder, a.id]);
  await execute("UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [a.sortOrder, b.id]);
}

async function normalizeSortOrders(groups: FavoriteGroup[]): Promise<void> {
  for (let i = 0; i < groups.length; i++) {
    await execute("UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [i, groups[i].id]);
  }
}

const FAVORITE_ISSUE_SELECT =
  "SELECT fi.id, fi.group_id, fi.issue_key, ji.summary, ji.status, ji.url, " +
  "fi.sort_order, fi.created_at " +
  "FROM favorite_issues fi " +
  "LEFT JOIN jira_issues ji ON ji.issue_key = fi.issue_key";

function mapFavoriteIssue(row: FavoriteIssueRow): FavoriteIssue {
  return {
    id: row.id,
    groupId: row.group_id,
    issueKey: row.issue_key,
    summary: row.summary,
    status: row.status,
    url: row.url,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export async function listFavoriteIssues(groupId: number): Promise<FavoriteIssue[]> {
  const rows = await select<FavoriteIssueRow>(
    `${FAVORITE_ISSUE_SELECT} WHERE fi.group_id = ? ` +
      "ORDER BY fi.sort_order ASC, fi.created_at ASC, fi.id ASC",
    [groupId],
  );
  return rows.map(mapFavoriteIssue);
}

export async function listAllFavoriteIssues(): Promise<FavoriteIssue[]> {
  // LEFT JOIN keeps ungrouped favorites (group_id IS NULL); ungrouped sort
  // last by giving them a synthetic sort_order beyond all real groups.
  const rows = await select<FavoriteIssueRow>(
    `${FAVORITE_ISSUE_SELECT} ` +
      "LEFT JOIN favorite_groups g ON g.id = fi.group_id " +
      "ORDER BY (fi.group_id IS NULL) ASC, g.sort_order ASC, g.id ASC, " +
      "fi.sort_order ASC, fi.created_at ASC, fi.id ASC",
  );
  return rows.map(mapFavoriteIssue);
}

export async function listUngroupedFavoriteIssues(): Promise<FavoriteIssue[]> {
  const rows = await select<FavoriteIssueRow>(
    `${FAVORITE_ISSUE_SELECT} WHERE fi.group_id IS NULL ` +
      "ORDER BY fi.sort_order ASC, fi.created_at ASC, fi.id ASC",
  );
  return rows.map(mapFavoriteIssue);
}

export async function pinIssueWithoutGroup(issueKey: string): Promise<number> {
  const trimmedKey = issueKey.trim().toUpperCase();
  if (!trimmedKey) {
    throw new Error("Issue key is required.");
  }
  const issue = await selectOne<{ issue_key: string }>(
    "SELECT issue_key FROM jira_issues WHERE issue_key = ?",
    [trimmedKey],
  );
  if (!issue) {
    throw new Error(`Issue ${trimmedKey} is not cached. Search for it first.`);
  }
  const duplicate = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_issues WHERE issue_key = ? AND group_id IS NULL",
    [trimmedKey],
  );
  if (duplicate) {
    throw new Error(`${trimmedKey} is already pinned (without group).`);
  }
  const max = await selectOne<{ max_order: number | null }>(
    "SELECT MAX(sort_order) AS max_order FROM favorite_issues WHERE group_id IS NULL",
  );
  const nextOrder = (max?.max_order ?? -1) + 1;
  const result = await execute(
    "INSERT INTO favorite_issues (group_id, issue_key, sort_order) VALUES (NULL, ?, ?)",
    [trimmedKey, nextOrder],
  );
  return Number(result.lastInsertId ?? 0);
}

export async function pinIssueToGroup(groupId: number, issueKey: string): Promise<number> {
  const trimmedKey = issueKey.trim().toUpperCase();
  if (!trimmedKey) {
    throw new Error("Issue key is required.");
  }
  const issue = await selectOne<{ issue_key: string }>(
    "SELECT issue_key FROM jira_issues WHERE issue_key = ?",
    [trimmedKey],
  );
  if (!issue) {
    throw new Error(`Issue ${trimmedKey} is not cached. Search for it first.`);
  }
  const group = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_groups WHERE id = ?",
    [groupId],
  );
  if (!group) {
    throw new Error("Favorite group not found.");
  }
  const duplicate = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_issues WHERE group_id = ? AND issue_key = ?",
    [groupId, trimmedKey],
  );
  if (duplicate) {
    throw new Error(`${trimmedKey} is already pinned in this group.`);
  }
  const max = await selectOne<{ max_order: number | null }>(
    "SELECT MAX(sort_order) AS max_order FROM favorite_issues WHERE group_id = ?",
    [groupId],
  );
  const nextOrder = (max?.max_order ?? -1) + 1;
  const result = await execute(
    "INSERT INTO favorite_issues (group_id, issue_key, sort_order) VALUES (?, ?, ?)",
    [groupId, trimmedKey, nextOrder],
  );
  return Number(result.lastInsertId ?? 0);
}

export async function unpinFavoriteIssue(id: number): Promise<void> {
  await execute("DELETE FROM favorite_issues WHERE id = ?", [id]);
}

export async function moveFavoriteIssueToGroup(
  id: number,
  newGroupId: number | null,
): Promise<void> {
  const current = await selectOne<{
    id: number;
    group_id: number | null;
    issue_key: string;
  }>(
    "SELECT id, group_id, issue_key FROM favorite_issues WHERE id = ?",
    [id],
  );
  if (!current) {
    throw new Error("Favorite issue not found.");
  }
  if (current.group_id === newGroupId) return;
  if (newGroupId !== null) {
    const targetGroup = await selectOne<{ id: number }>(
      "SELECT id FROM favorite_groups WHERE id = ?",
      [newGroupId],
    );
    if (!targetGroup) {
      throw new Error("Target group not found.");
    }
    const duplicate = await selectOne<{ id: number }>(
      "SELECT id FROM favorite_issues WHERE group_id = ? AND issue_key = ?",
      [newGroupId, current.issue_key],
    );
    if (duplicate) {
      throw new Error(`${current.issue_key} is already pinned in the target group.`);
    }
    const max = await selectOne<{ max_order: number | null }>(
      "SELECT MAX(sort_order) AS max_order FROM favorite_issues WHERE group_id = ?",
      [newGroupId],
    );
    const nextOrder = (max?.max_order ?? -1) + 1;
    await execute(
      "UPDATE favorite_issues SET group_id = ?, sort_order = ? WHERE id = ?",
      [newGroupId, nextOrder, id],
    );
    return;
  }
  // Move to ungrouped.
  const duplicate = await selectOne<{ id: number }>(
    "SELECT id FROM favorite_issues WHERE issue_key = ? AND group_id IS NULL",
    [current.issue_key],
  );
  if (duplicate) {
    throw new Error(`${current.issue_key} is already pinned without a group.`);
  }
  const max = await selectOne<{ max_order: number | null }>(
    "SELECT MAX(sort_order) AS max_order FROM favorite_issues WHERE group_id IS NULL",
  );
  const nextOrder = (max?.max_order ?? -1) + 1;
  await execute(
    "UPDATE favorite_issues SET group_id = NULL, sort_order = ? WHERE id = ?",
    [nextOrder, id],
  );
}
