import { describe, expect, it } from "vitest";
import {
  JiraApiError,
  JiraAuthError,
  JiraConfigError,
  JiraForbiddenError,
  JiraNetworkError,
  JiraNotFoundError,
} from "./errors";
import { formatJiraError } from "./format";

describe("formatJiraError", () => {
  it("returns configuration errors without extra wording", () => {
    const message = formatJiraError(new JiraConfigError("Configure Jira first."));

    expect(message).toBe("Configure Jira first.");
  });

  it("formats the known Jira error kinds", () => {
    expect(formatJiraError(new JiraNetworkError("DNS failed."))).toBe(
      "Could not reach Jira. Check your connection and base URL. DNS failed.",
    );
    expect(formatJiraError(new JiraAuthError())).toBe(
      "Jira rejected the credentials. Check your email and API token in Settings.",
    );
    expect(formatJiraError(new JiraForbiddenError("Missing scope."))).toBe(
      "Your Jira account does not have permission for this action. Missing scope.",
    );
    expect(formatJiraError(new JiraNotFoundError("ABC-1"))).toBe(
      "Jira could not find the requested resource. ABC-1",
    );
  });

  it("includes API status when Jira returns an unexpected error", () => {
    const message = formatJiraError(new JiraApiError(429, "Rate limited."));

    expect(message).toBe("Jira returned an error (429): Rate limited.");
  });

  it("falls back for regular errors and unknown causes", () => {
    expect(formatJiraError(new Error("Local failure."))).toBe("Local failure.");
    expect(formatJiraError("bad", { action: "Issue lookup" })).toBe(
      "Issue lookup failed.",
    );
  });
});
