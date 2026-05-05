import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute, selectOne } from "../../db";
import { getAuthorEmails, setAuthorEmails, splitEmails } from "./authorEmailsRepo";

vi.mock("../../db", () => ({
  execute: vi.fn(),
  selectOne: vi.fn(),
}));

const executeMock = vi.mocked(execute);
const selectOneMock = vi.mocked(selectOne);

describe("authorEmailsRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({ rowsAffected: 1 });
  });

  it("splits, trims, and lowercases comma, semicolon, and whitespace separated emails", () => {
    expect(splitEmails(" A@EXAMPLE.COM, b@example.com; c@example.com\n")).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("loads configured author emails", async () => {
    selectOneMock.mockResolvedValue({ value: "a@example.com, B@EXAMPLE.COM" });

    await expect(getAuthorEmails()).resolves.toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("returns an empty list when no emails are configured", async () => {
    selectOneMock.mockResolvedValue(null);

    await expect(getAuthorEmails()).resolves.toEqual([]);
  });

  it("persists cleaned author emails", async () => {
    await setAuthorEmails(" A@EXAMPLE.COM; b@example.com ");

    expect(executeMock).toHaveBeenCalledWith(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
      ["git_author_emails", "a@example.com, b@example.com"],
    );
  });
});
