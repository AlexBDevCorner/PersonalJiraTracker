import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, select, selectOne } from "../../db";
import {
  createFavoriteGroup,
  listAllFavoriteIssues,
  listFavoriteGroups,
  moveFavoriteGroup,
  moveFavoriteIssueToGroup,
  pinIssueToGroup,
  pinIssueWithoutGroup,
} from "./favoritesRepo";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  select: vi.fn(),
  selectOne: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectMock = vi.mocked(select);
const selectOneMock = vi.mocked(selectOne);

describe("favoritesRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 99 });
  });

  it("maps favorite groups and issue counts from database rows", async () => {
    selectMock.mockResolvedValue([
      {
        id: 1,
        name: "Meetings",
        sort_order: 0,
        created_at: "2026-05-01",
        issue_count: 2,
      },
    ]);

    const groups = await listFavoriteGroups();

    expect(groups).toEqual([
      {
        id: 1,
        name: "Meetings",
        sortOrder: 0,
        createdAt: "2026-05-01",
        issueCount: 2,
      },
    ]);
  });

  it("creates a trimmed group after duplicate and order checks", async () => {
    selectOneMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ max_order: 4 });
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 42 });

    const id = await createFavoriteGroup("  Planning  ");

    expect(id).toBe(42);
    expect(selectOneMock).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM favorite_groups WHERE name = ? COLLATE NOCASE",
      ["Planning"],
    );
    expect(executeMock).toHaveBeenCalledWith(
      "INSERT INTO favorite_groups (name, sort_order) VALUES (?, ?)",
      ["Planning", 5],
    );
  });

  it("rejects blank and duplicate group names", async () => {
    await expect(createFavoriteGroup(" ")).rejects.toThrow("Group name is required.");
    expect(selectOneMock).not.toHaveBeenCalled();

    selectOneMock.mockResolvedValue({ id: 1 });
    await expect(createFavoriteGroup("Planning")).rejects.toThrow(
      'A group named "Planning" already exists.',
    );
  });

  it("swaps group sort orders when moving a group", async () => {
    selectMock.mockResolvedValue([
      { id: 1, name: "A", sort_order: 0, created_at: "1", issue_count: 0 },
      { id: 2, name: "B", sort_order: 1, created_at: "2", issue_count: 0 },
    ]);

    await moveFavoriteGroup(2, "up");

    expect(executeMock).toHaveBeenNthCalledWith(
      1,
      "UPDATE favorite_groups SET sort_order = ? WHERE id = ?",
      [0, 2],
    );
    expect(executeMock).toHaveBeenNthCalledWith(
      2,
      "UPDATE favorite_groups SET sort_order = ? WHERE id = ?",
      [1, 1],
    );
  });

  it("normalizes tied sort orders before moving a group", async () => {
    selectMock
      .mockResolvedValueOnce([
        { id: 1, name: "A", sort_order: 0, created_at: "1", issue_count: 0 },
        { id: 2, name: "B", sort_order: 0, created_at: "2", issue_count: 0 },
      ])
      .mockResolvedValueOnce([
        { id: 1, name: "A", sort_order: 0, created_at: "1", issue_count: 0 },
        { id: 2, name: "B", sort_order: 1, created_at: "2", issue_count: 0 },
      ]);

    await moveFavoriteGroup(2, "up");

    expect(executeMock.mock.calls).toEqual([
      ["UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [0, 1]],
      ["UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [1, 2]],
      ["UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [0, 2]],
      ["UPDATE favorite_groups SET sort_order = ? WHERE id = ?", [1, 1]],
    ]);
  });

  it("pins a cached issue without a group using normalized keys and next order", async () => {
    selectOneMock
      .mockResolvedValueOnce({ issue_key: "ABC-1" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ max_order: 1 });
    executeMock.mockResolvedValue({ rowsAffected: 1, lastInsertId: 7 });

    const id = await pinIssueWithoutGroup(" abc-1 ");

    expect(id).toBe(7);
    expect(executeMock).toHaveBeenCalledWith(
      "INSERT INTO favorite_issues (group_id, issue_key, sort_order) VALUES (NULL, ?, ?)",
      ["ABC-1", 2],
    );
  });

  it("rejects ungrouped pins for missing cache rows and duplicates", async () => {
    selectOneMock.mockResolvedValueOnce(null);
    await expect(pinIssueWithoutGroup("abc-1")).rejects.toThrow(
      "Issue ABC-1 is not cached. Search for it first.",
    );

    selectOneMock
      .mockResolvedValueOnce({ issue_key: "ABC-1" })
      .mockResolvedValueOnce({ id: 3 });
    await expect(pinIssueWithoutGroup("ABC-1")).rejects.toThrow(
      "ABC-1 is already pinned (without group).",
    );
  });

  it("pins a cached issue to an existing group", async () => {
    selectOneMock
      .mockResolvedValueOnce({ issue_key: "ABC-1" })
      .mockResolvedValueOnce({ id: 5 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ max_order: null });

    await pinIssueToGroup(5, "abc-1");

    expect(executeMock).toHaveBeenCalledWith(
      "INSERT INTO favorite_issues (group_id, issue_key, sort_order) VALUES (?, ?, ?)",
      [5, "ABC-1", 0],
    );
  });

  it("moves an issue into another group at the end of that group", async () => {
    selectOneMock
      .mockResolvedValueOnce({ id: 10, group_id: null, issue_key: "ABC-1" })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ max_order: 6 });

    await moveFavoriteIssueToGroup(10, 2);

    expect(executeMock).toHaveBeenCalledWith(
      "UPDATE favorite_issues SET group_id = ?, sort_order = ? WHERE id = ?",
      [2, 7, 10],
    );
  });

  it("moves an issue to ungrouped when no duplicate exists", async () => {
    selectOneMock
      .mockResolvedValueOnce({ id: 10, group_id: 2, issue_key: "ABC-1" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ max_order: 3 });

    await moveFavoriteIssueToGroup(10, null);

    expect(executeMock).toHaveBeenCalledWith(
      "UPDATE favorite_issues SET group_id = NULL, sort_order = ? WHERE id = ?",
      [4, 10],
    );
  });

  it("rejects moves when the target would duplicate an issue", async () => {
    selectOneMock
      .mockResolvedValueOnce({ id: 10, group_id: 1, issue_key: "ABC-1" })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce({ id: 11 });

    await expect(moveFavoriteIssueToGroup(10, 2)).rejects.toThrow(
      "ABC-1 is already pinned in the target group.",
    );
  });

  it("maps all favorites with grouped favorites before ungrouped favorites", async () => {
    selectMock.mockResolvedValue([
      {
        id: 1,
        group_id: 5,
        issue_key: "ABC-1",
        summary: "Grouped",
        status: "Open",
        url: "https://example.atlassian.net/browse/ABC-1",
        sort_order: 0,
        created_at: "2026-05-01",
      },
      {
        id: 2,
        group_id: null,
        issue_key: "XYZ-2",
        summary: null,
        status: null,
        url: null,
        sort_order: 1,
        created_at: "2026-05-02",
      },
    ]);

    const issues = await listAllFavoriteIssues();

    expect(issues).toEqual([
      {
        id: 1,
        groupId: 5,
        issueKey: "ABC-1",
        summary: "Grouped",
        status: "Open",
        url: "https://example.atlassian.net/browse/ABC-1",
        sortOrder: 0,
        createdAt: "2026-05-01",
      },
      {
        id: 2,
        groupId: null,
        issueKey: "XYZ-2",
        summary: null,
        status: null,
        url: null,
        sortOrder: 1,
        createdAt: "2026-05-02",
      },
    ]);
    expect(selectMock.mock.calls[0]?.[0]).toContain(
      "ORDER BY (fi.group_id IS NULL) ASC",
    );
  });
});
