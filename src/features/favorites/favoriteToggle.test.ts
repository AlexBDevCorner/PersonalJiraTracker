import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, select, selectOne } from "../../db";
import {
  isFavoriteIssue,
  listFavoriteIssueKeys,
  unpinIssueFromAllGroups,
} from "./favoriteToggle";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  select: vi.fn(),
  selectOne: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectMock = vi.mocked(select);
const selectOneMock = vi.mocked(selectOne);

describe("favoriteToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1 });
  });

  it("lists distinct favorite issue keys as a set", async () => {
    selectMock.mockResolvedValue([{ issue_key: "ABC-1" }, { issue_key: "XYZ-2" }]);

    const keys = await listFavoriteIssueKeys();

    expect(keys).toEqual(new Set(["ABC-1", "XYZ-2"]));
    expect(selectMock).toHaveBeenCalledWith("SELECT DISTINCT issue_key FROM favorite_issues");
  });

  it("checks whether an issue is favorited anywhere", async () => {
    selectOneMock.mockResolvedValueOnce({ id: 12 }).mockResolvedValueOnce(null);

    await expect(isFavoriteIssue("ABC-1")).resolves.toBe(true);
    await expect(isFavoriteIssue("XYZ-2")).resolves.toBe(false);
    expect(selectOneMock).toHaveBeenNthCalledWith(
      1,
      "SELECT id FROM favorite_issues WHERE issue_key = ? LIMIT 1",
      ["ABC-1"],
    );
  });

  it("unpins an issue from every group", async () => {
    await unpinIssueFromAllGroups("ABC-1");

    expect(executeMock).toHaveBeenCalledWith(
      "DELETE FROM favorite_issues WHERE issue_key = ?",
      ["ABC-1"],
    );
  });
});
