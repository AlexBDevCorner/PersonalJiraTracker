export type JiraErrorKind =
  | "config"
  | "network"
  | "auth"
  | "forbidden"
  | "not_found"
  | "api";

export class JiraError extends Error {
  readonly kind: JiraErrorKind;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(kind: JiraErrorKind, message: string, status?: number, cause?: unknown) {
    super(message);
    this.name = "JiraError";
    this.kind = kind;
    this.status = status;
    this.cause = cause;
  }
}

export class JiraConfigError extends JiraError {
  constructor(message: string) {
    super("config", message);
    this.name = "JiraConfigError";
  }
}

export class JiraNetworkError extends JiraError {
  constructor(message: string, cause?: unknown) {
    super("network", message, undefined, cause);
    this.name = "JiraNetworkError";
  }
}

export class JiraAuthError extends JiraError {
  constructor(message = "Jira rejected the credentials.") {
    super("auth", message, 401);
    this.name = "JiraAuthError";
  }
}

export class JiraForbiddenError extends JiraError {
  constructor(message = "Your Jira account does not have permission to perform this action.") {
    super("forbidden", message, 403);
    this.name = "JiraForbiddenError";
  }
}

export class JiraNotFoundError extends JiraError {
  constructor(message = "The requested Jira resource was not found.") {
    super("not_found", message, 404);
    this.name = "JiraNotFoundError";
  }
}

export class JiraApiError extends JiraError {
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super("api", message, status);
    this.name = "JiraApiError";
    this.body = body;
  }
}

export function toJiraError(action: string, status: number, body: unknown): JiraError {
  const detail = extractJiraMessage(body) ?? `Jira ${action} failed with status ${status}.`;
  switch (status) {
    case 401:
      return new JiraAuthError(detail);
    case 403:
      return new JiraForbiddenError(detail);
    case 404:
      return new JiraNotFoundError(detail);
    default:
      return new JiraApiError(status, detail, body);
  }
}

function extractJiraMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const messages = obj.errorMessages;
  if (Array.isArray(messages) && messages.length > 0 && typeof messages[0] === "string") {
    return messages.join(" ");
  }
  const errors = obj.errors;
  if (errors && typeof errors === "object") {
    const values = Object.values(errors as Record<string, unknown>).filter(
      (v): v is string => typeof v === "string",
    );
    if (values.length > 0) return values.join(" ");
  }
  if (typeof obj.message === "string") return obj.message;
  return null;
}
