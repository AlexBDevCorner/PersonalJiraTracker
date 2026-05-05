export class DbError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DbError";
    this.cause = cause;
  }
}

export function toDbError(action: string, cause: unknown): DbError {
  const detail =
    cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "unknown error";
  return new DbError(`Database ${action} failed: ${detail}`, cause);
}
