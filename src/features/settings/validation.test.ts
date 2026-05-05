import { describe, expect, it } from "vitest";
import { validateSettings, type SettingsFormValues } from "./validation";

const validValues: SettingsFormValues = {
  jiraBaseUrl: "https://example.atlassian.net",
  email: "person@example.com",
  apiToken: "secret-token",
};

describe("validateSettings", () => {
  it("returns no errors for a complete valid form", () => {
    const errors = validateSettings(validValues, { hasExistingToken: false });

    expect(errors).toEqual({});
  });

  it("requires URL, email, and token when no token is already saved", () => {
    const errors = validateSettings(
      { jiraBaseUrl: " ", email: "", apiToken: " " },
      { hasExistingToken: false },
    );

    expect(errors).toEqual({
      jiraBaseUrl: "Jira base URL is required.",
      email: "Email is required.",
      apiToken: "API token is required.",
    });
  });

  it("allows an empty token when an existing token is saved", () => {
    const errors = validateSettings(
      { ...validValues, apiToken: "" },
      { hasExistingToken: true },
    );

    expect(errors.apiToken).toBeUndefined();
  });

  it("rejects invalid URLs and email addresses", () => {
    const errors = validateSettings(
      { jiraBaseUrl: "ftp://example.com", email: "not-an-email", apiToken: "x" },
      { hasExistingToken: false },
    );

    expect(errors).toMatchObject({
      jiraBaseUrl: "Enter a valid Jira Cloud URL ending in .atlassian.net.",
      email: "Enter a valid email address.",
    });
  });

  it("rejects non-Atlassian HTTPS hosts", () => {
    const errors = validateSettings(
      { ...validValues, jiraBaseUrl: "https://example.com" },
      { hasExistingToken: false },
    );

    expect(errors.jiraBaseUrl).toBe(
      "Enter a valid Jira Cloud URL ending in .atlassian.net.",
    );
  });
});
