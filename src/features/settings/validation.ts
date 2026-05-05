export type SettingsFormValues = {
  jiraBaseUrl: string;
  email: string;
  apiToken: string;
};

export type SettingsFormErrors = Partial<Record<keyof SettingsFormValues, string>>;

export type ValidationOptions = {
  hasExistingToken: boolean;
};

export function validateSettings(
  values: SettingsFormValues,
  options: ValidationOptions,
): SettingsFormErrors {
  const errors: SettingsFormErrors = {};

  const url = values.jiraBaseUrl.trim();
  if (!url) {
    errors.jiraBaseUrl = "Jira base URL is required.";
  } else if (!isValidJiraUrl(url)) {
    errors.jiraBaseUrl = "Enter a valid Jira Cloud URL ending in .atlassian.net.";
  }

  const email = values.email.trim();
  if (!email) {
    errors.email = "Email is required.";
  } else if (!isValidEmail(email)) {
    errors.email = "Enter a valid email address.";
  }

  const token = values.apiToken.trim();
  if (!token && !options.hasExistingToken) {
    errors.apiToken = "API token is required.";
  }

  return errors;
}

function isValidJiraUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  return parsed.hostname.toLowerCase().endsWith(".atlassian.net");
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
