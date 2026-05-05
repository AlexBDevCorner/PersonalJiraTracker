// Lightweight in-memory logger so the app can keep a debugging trail without
// pulling in a Tauri filesystem plugin. Logs mirror to the console (so they
// show up in dev tools and the WebView log) and are exposed through getLogs()
// for the Settings page "Copy logs" button.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: string;
  details?: string;
};

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) {
    try {
      fn();
    } catch (cause) {
      console.error("log subscriber threw", cause);
    }
  }
}

function describe(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) {
    const stack = value.stack ? `\n${value.stack}` : "";
    return `${value.name}: ${value.message}${stack}`;
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function append(level: LogLevel, message: string, details?: unknown): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    details: describe(details),
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
  const consoleMethod =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.info;
  if (entry.details !== undefined) {
    consoleMethod(`[${level}] ${message}`, details);
  } else {
    consoleMethod(`[${level}] ${message}`);
  }
  notify();
}

export const log = {
  debug(message: string, details?: unknown): void {
    append("debug", message, details);
  },
  info(message: string, details?: unknown): void {
    append("info", message, details);
  },
  warn(message: string, details?: unknown): void {
    append("warn", message, details);
  },
  error(message: string, details?: unknown): void {
    append("error", message, details);
  },
};

export function getLogs(): readonly LogEntry[] {
  return buffer.slice();
}

export function clearLogs(): void {
  buffer.length = 0;
  notify();
}

export function subscribeLogs(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function formatLogsForExport(entries: readonly LogEntry[] = getLogs()): string {
  return entries
    .map((entry) => {
      const head = `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.message}`;
      return entry.details ? `${head}\n  ${entry.details.replace(/\n/g, "\n  ")}` : head;
    })
    .join("\n");
}

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    log.error("Uncaught window error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    log.error("Unhandled promise rejection", event.reason);
  });
}
