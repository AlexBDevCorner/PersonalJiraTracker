# db

Local SQLite access (REQ-DATA-001, REQ-ARCH-001).

## Architecture

- The Tauri Rust shell registers `tauri-plugin-sql` with the SQLite feature and a
  list of migrations (see `src-tauri/src/migrations.rs`). Migrations run on first
  `Database.load(...)` and are idempotent.
- The TypeScript layer in this directory exposes a thin async API (`getDb`,
  `execute`, `select`, `selectOne`) backed by the plugin, plus a `DbError` that
  formats plugin errors for the UI.
- App startup waits on `initDb()` via `useDbReady`. Failures surface in an
  `ErrorBanner` with a retry action instead of crashing the app.

## Domain schema (migration v2)

Added by ticket 004.

- `settings` — singleton row (`id = 1`) holding `jira_base_url`, `email`, and
  `api_token_ref` (a reference into Tauri secure storage; the token itself is
  not stored in SQLite). Backs REQ-AUTH-001 / REQ-AUTH-002.
- `jira_issues` — local cache keyed by `issue_key` with `summary`, `status`,
  `url`, and `last_fetched_at`. Backs REQ-UI-007.
- `favorite_groups` — user-defined groups (`Meetings`, `Features`, ...) with a
  `sort_order` for manual ordering. Backs REQ-UI-006.
- `favorite_issues` — pin of an issue into a group. `(group_id, issue_key)` is
  unique; both FKs cascade on delete. Backs REQ-UI-006.
- `worklogs` — local worklog entries. Columns: `id` (local ID), `issue_key`,
  `work_date` (`YYYY-MM-DD`), `time_spent_hours` (REAL, decimal hours),
  `comment` (NOT NULL — REQ-WL-004), nullable `jira_worklog_id`, and
  `sync_status` constrained to `draft | submitted | modified | deleted`
  (REQ-WL-001, REQ-WL-002, REQ-WL-003).

All tables use `CREATE TABLE IF NOT EXISTS` so the migration is safely
re-runnable.
