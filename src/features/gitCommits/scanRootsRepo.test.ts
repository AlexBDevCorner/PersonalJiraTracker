import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, select } from "../../db";
import { addScanRoot, listScanRoots, removeScanRoot } from "./scanRootsRepo";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  select: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectMock = vi.mocked(select);

describe("scanRootsRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1 });
  });

  it("maps scan root rows", async () => {
    selectMock.mockResolvedValue([{ path: "C:/repo", created_at: "2026-05-05" }]);

    await expect(listScanRoots()).resolves.toEqual([
      { path: "C:/repo", createdAt: "2026-05-05" },
    ]);
  });

  it("adds scan roots idempotently", async () => {
    await addScanRoot("C:/repo");

    expect(executeMock).toHaveBeenCalledWith(
      "INSERT OR IGNORE INTO git_scan_roots (path) VALUES (?)",
      ["C:/repo"],
    );
  });

  it("removes scan roots by path", async () => {
    await removeScanRoot("C:/repo");

    expect(executeMock).toHaveBeenCalledWith(
      "DELETE FROM git_scan_roots WHERE path = ?",
      ["C:/repo"],
    );
  });
});
