import { JiraError } from "./errors";

export type JiraErrorContext = {
  // Short noun used in fallback wording: "issue lookup", "submit", etc.
  action?: string;
};

export function formatJiraError(cause: unknown, context: JiraErrorContext = {}): string {
  const action = context.action ?? "Jira request";
  if (cause instanceof JiraError) {
    switch (cause.kind) {
      case "config":
        return cause.message;
      case "network":
        return `Could not reach Jira. Check your connection and base URL. ${cause.message}`;
      case "auth":
        return "Jira rejected the credentials. Check your email and API token in Settings.";
      case "forbidden":
        return `Your Jira account does not have permission for this action. ${cause.message}`;
      case "not_found":
        return `Jira could not find the requested resource. ${cause.message}`;
      default:
        return cause.status
          ? `Jira returned an error (${cause.status}): ${cause.message}`
          : `Jira returned an error: ${cause.message}`;
    }
  }
  if (cause instanceof Error) return cause.message;
  return `${action} failed.`;
}
