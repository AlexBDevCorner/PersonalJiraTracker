import { invoke } from "@tauri-apps/api/core";
import {
  JiraApiError,
  JiraAuthError,
  JiraConfigError,
  JiraForbiddenError,
  JiraNetworkError,
  JiraNotFoundError,
  toJiraError,
} from "./errors";

export type JiraCredentials = {
  baseUrl: string;
  email: string;
  apiTokenRef: string;
};

export type JiraRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
};

export type JiraClient = {
  request<T = unknown>(path: string, options?: JiraRequestOptions): Promise<T>;
  get<T = unknown>(path: string, query?: JiraRequestOptions["query"]): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
};

export function createJiraClient(credentials: JiraCredentials): JiraClient {
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);

  async function request<T>(path: string, options: JiraRequestOptions = {}): Promise<T> {
    try {
      return await invoke<T>("jira_request", {
        request: {
          baseUrl,
          email: credentials.email,
          apiTokenRef: credentials.apiTokenRef,
          path,
          method: options.method ?? "GET",
          query: options.query,
          body: options.body,
        },
      });
    } catch (cause) {
      throw toClientJiraError(options.method ?? "GET", path, cause);
    }
  }

  return {
    request,
    get: (path, query) => request(path, { method: "GET", query }),
    post: (path, body) => request(path, { method: "POST", body }),
    put: (path, body) => request(path, { method: "PUT", body }),
    delete: (path) => request(path, { method: "DELETE" }),
  };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new JiraConfigError("Jira base URL is not configured.");
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      throw new JiraConfigError(`Jira Cloud base URL must use https (got "${url.protocol}").`);
    }
    if (!url.hostname.toLowerCase().endsWith(".atlassian.net")) {
      throw new JiraConfigError("Jira Cloud base URL must be an atlassian.net host.");
    }
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch (cause) {
    if (cause instanceof JiraConfigError) throw cause;
    throw new JiraConfigError(`Jira base URL is not a valid URL: "${raw}".`);
  }
}

type JiraCommandError = {
  kind?: string;
  message?: string;
  status?: number;
  body?: unknown;
};

function toClientJiraError(method: string, path: string, cause: unknown) {
  const error = cause as JiraCommandError;
  if (error && typeof error === "object") {
    switch (error.kind) {
      case "config":
        return new JiraConfigError(error.message ?? "Jira is not configured correctly.");
      case "network":
        return new JiraNetworkError(error.message ?? "Could not reach Jira.", cause);
      case "auth":
        return new JiraAuthError(error.message);
      case "forbidden":
        return new JiraForbiddenError(error.message);
      case "not_found":
        return new JiraNotFoundError(error.message);
      case "api":
        return new JiraApiError(
          error.status ?? 500,
          error.message ?? `Jira ${method} ${path} failed.`,
          error.body,
        );
    }
    if (typeof error.status === "number") {
      return toJiraError(`${method} ${path}`, error.status, error.body);
    }
  }

  const detail = cause instanceof Error ? cause.message : "Unknown network error.";
  return new JiraNetworkError(`Could not reach Jira: ${detail}`, cause);
}
