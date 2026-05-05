import { describe, expect, it } from "vitest";
import { DbError, toDbError } from "./errors";

describe("toDbError", () => {
  it("wraps Error causes with the database action", () => {
    const cause = new Error("disk full");
    const error = toDbError("execute", cause);

    expect(error).toBeInstanceOf(DbError);
    expect(error.message).toBe("Database execute failed: disk full");
    expect(error.cause).toBe(cause);
  });

  it("handles string and unknown causes", () => {
    expect(toDbError("select", "locked").message).toBe(
      "Database select failed: locked",
    );
    expect(toDbError("load", null).message).toBe(
      "Database load failed: unknown error",
    );
  });
});
