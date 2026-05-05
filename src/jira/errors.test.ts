import { describe, expect, it } from "vitest";
import {
  JiraApiError,
  JiraAuthError,
  JiraForbiddenError,
  JiraNotFoundError,
  toJiraError,
} from "./errors";

describe("toJiraError", () => {
  it("maps known HTTP statuses to typed Jira errors", () => {
    expect(toJiraError("lookup", 401, { message: "Bad credentials" })).toBeInstanceOf(
      JiraAuthError,
    );
    expect(toJiraError("lookup", 403, { message: "No access" })).toBeInstanceOf(
      JiraForbiddenError,
    );
    expect(toJiraError("lookup", 404, { message: "Missing" })).toBeInstanceOf(
      JiraNotFoundError,
    );
  });

  it("extracts Jira error messages from supported body shapes", () => {
    expect(toJiraError("lookup", 400, { errorMessages: ["A", "B"] }).message).toBe(
      "A B",
    );
    expect(toJiraError("lookup", 400, { errors: { field: "Invalid" } }).message).toBe(
      "Invalid",
    );
    expect(toJiraError("lookup", 400, { message: "Plain message" }).message).toBe(
      "Plain message",
    );
  });

  it("falls back to action and status when Jira body has no message", () => {
    const error = toJiraError("submit", 500, {});

    expect(error).toBeInstanceOf(JiraApiError);
    expect(error.message).toBe("Jira submit failed with status 500.");
  });
});
