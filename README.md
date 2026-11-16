# Jira Ticket Tracker

A desktop ticket board and local-first timesheet for Jira Cloud. Manage assigned
tickets, log time in a weekly grid, and push your time reports when you're ready.
Built with Tauri (Rust) + React + TypeScript on top of a local SQLite database.

The app keeps an editable copy of your week in SQLite so the UI is fast and
survives flaky connections. Worklogs are explicit `draft / submitted /
modified / deleted` states; you press **Submit** to reconcile pending changes
with Jira in one batch.

## Features

- **Personal Kanban board** — open **Board** to see all tickets assigned to you,
  including completed tickets. Columns use the existing statuses for your tickets'
  projects and issue types, including empty workflow statuses. Cards show the ticket
  number and title; click the number to open Jira. Drag a card or use **Move to…**
  to save its status immediately to Jira. The board refreshes every minute while
  visible and when you return to the app or reconnect. Failed refreshes keep the
  last board visible. Workflow restrictions, required fields, and ambiguous
  transitions direct you to Jira to complete the move. Board changes require a
  connection; they are separate from timesheet drafts and the Submit button.
- **Weekly timesheet grid** with per-day cells and daily/weekly totals.
- **Carry tickets forward** — click the plus beside a ticket in another week's
  timesheet to add it to the current week. A checkmark shows tickets already there.
- **Cell popover** for entering hours and a comment without leaving the grid.
- **Pending-change tracking** — drafts, edits, and deletions stay local until
  you submit. Retry-safe: if Jira accepts a worklog but the response fails,
  the next submit adopts the existing remote worklog instead of creating a
  duplicate.
- **Two-way sync** — pulls your worklogs for the visible week from Jira
  (including issues you haven't pinned), merges without overwriting your
  pending edits, and removes local rows that were deleted upstream.
- **Favorites** — pin frequently used tickets into groups for quick access.
- **Command palette** — fast issue lookup by key or cached summary.
- **Git commits panel** — point at local repo folders and the app surfaces
  recent commits whose messages mention an issue key, so you can quickly log
  time against the work you actually did.
- **Credentials in OS keyring** — your Jira API token is stored via the
  platform keyring (Windows Credential Manager / macOS Keychain / Secret
  Service on Linux). SQLite only stores a reference to it.

## Requirements

- **Node.js 20+** and npm.
- **Rust toolchain** (stable). Install via [rustup](https://rustup.rs/).
- Platform-specific Tauri prerequisites — see the
  [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/).
  - Windows: WebView2 runtime (preinstalled on Windows 10/11) and the MSVC
    build tools.
  - macOS: Xcode Command Line Tools.
  - Linux: `webkit2gtk`, `libssl-dev`, etc. (see the Tauri docs).
- A **Jira Cloud** account and an
  [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens).

## Quick start

```sh
git clone <this-repo>
cd JiraTicketTracker
npm install
npm run tauri dev
```

The first launch creates a local SQLite database (`tauri-plugin-sql` runs the
migrations in `src-tauri/src/migrations.rs`) and opens the timesheet on the
current week. Open **Settings** to enter your Jira base URL, email, and API
token, then click **Test connection** before saving.

## Configuration

All configuration is done in-app via the Settings page. There is no `.env`
file and the app reads no environment variables.

| Field            | Example                           | Notes                                                  |
| ---------------- | --------------------------------- | ------------------------------------------------------ |
| Jira base URL    | `https://acme.atlassian.net`      | Must be `https` and end with `.atlassian.net`.         |
| Email            | `you@example.com`                 | The Atlassian account email tied to the API token.    |
| API token        | `ATATT3xFf...`                    | Stored in the OS keyring, never in SQLite.            |

A **Test connection** button calls `/rest/api/3/myself` and reports the
account it resolves so you can confirm the credentials are correct before
saving.

### Git repositories in WSL2

In the Windows app, open **Settings → Git folders** and add a WSL folder, for example
`\\wsl$\Ubuntu\home\bobale` or `\\wsl.localhost\Ubuntu\home\bobale\PersonalJiraTracker`.
Both parent folders containing repositories and individual repositories are supported.
Windows and WSL folders can be configured together; their commits appear in the same panel.

Replace `Ubuntu` with the installed distribution name shown by `wsl --list --quiet`.
The scanner discovers repositories and runs Git inside that distribution as its default
Linux user, so Git must be installed there. WSL may start the distribution when scanning.
Linked Git worktrees are supported. Discovery uses the same depth limit (six levels)
and generated-folder exclusions as local scanning and skips symlinked child directories.

Configure **Git author emails** to include the email used for your WSL commits.
Only non-merge commits in the selected week whose messages contain a Jira key are shown.
Missing distributions, inaccessible roots, and Git failures appear in the commits panel.
When running the Linux build of the app inside WSL, use native paths such as `/home/bobale`.

## Commands

| Command                                            | What it does                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                                      | Vite dev server only (port 1420). UI iteration without the Rust shell.      |
| `npm run tauri dev`                                | Full desktop app. Required for anything that hits `invoke(...)`.            |
| `npm run build`                                    | Type-check (`tsc`) and produce the frontend bundle in `dist/`.              |
| `npm run tauri build`                              | Build the platform installer (MSI/NSIS on Windows, .dmg on macOS, etc.).    |
| `npm test`                                         | Run the Vitest suite once.                                                  |
| `npx vitest run path/to/file.test.ts`              | Run a single test file. Use `-t "<name>"` to filter by name.                |
| `cargo test --manifest-path src-tauri/Cargo.toml`  | Run Rust tests (e.g. migration ordering invariants).                        |

## Architecture (short version)

```
React UI  ->  app state  ->  local SQLite  ->  sync layer  ->  Jira REST API
```

- The Rust shell exposes a deliberately small command surface to the
  frontend: `db_execute` / `db_select` (with a hardcoded SQL allowlist),
  `jira_request` (single proxy for all Jira HTTP, base URL constrained to
  `*.atlassian.net`), token storage commands, and a git-commit scanner.
- The frontend never talks to Jira directly — every request goes through the
  Rust proxy.
- Migrations are append-only and live in `src-tauri/src/migrations.rs`.
- Each `src/features/<feature>/` directory owns its components, repos
  (SQLite access), and tests. `src/jira/` holds the typed Jira client.

A few invariants worth knowing if you're going to change this code:

- **SQL allowlist.** `db_execute` / `db_select` only accept queries listed in
  `ALLOWED_EXECUTE` / `ALLOWED_SELECT` (`src-tauri/src/db.rs`). Whitespace is
  normalized before matching, so format SQL however you like — but any new
  query, even a trivial parameter change, must be added to the list or it
  fails at runtime with "Database … statement is not allowed."
- **Migration runner is finicky.** `tauri-plugin-sql` is flaky on
  multi-statement SQL combining `INSERT ... SELECT` with `ALTER ... RENAME`.
  Keep one DDL/DML statement per migration and split table rebuilds the same
  way. Migrations are append-only and tested for monotonic ordering.
- **Retry-safe submit.** `submit_attempts` is incremented before each create
  attempt; on retry, `tryAdoptOrphanedWorklog` searches Jira for a worklog
  matching `(date, hours within 1s, exact comment, author accountId)` and
  adopts it instead of creating a duplicate.
- **Account identity is fail-closed.** `syncWeekFromJira` and
  `hydrateIssueForWeek` refuse to run if the signed-in user's `accountId`
  can't be resolved against the current credentials, because
  `reconcileRemovedWorklogs` would otherwise delete local rows that simply
  belong to a different user.

## Testing

- **Frontend:** Vitest. 80+ tests covering Jira client behavior, worklog
  sync, repos, and validation.
- **Rust:** `cargo test` covers migration ordering and other shell-side
  invariants.

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

On Windows with WSL Ubuntu and Git installed, run the WSL integration test explicitly:

```sh
cargo test --manifest-path src-tauri/Cargo.toml scans_wsl_repositories_and_worktrees_with_native_roots -- --ignored
```

Set `WSL_TEST_DISTRIBUTION` to use a distribution other than `Ubuntu`. The test creates
temporary repositories and a linked worktree, then removes them when finished.

## Known limitations

- **Atlassian Cloud only.** The Jira base URL is validated to
  `https://*.atlassian.net` on both the frontend and the Rust proxy. Server
  / Data Center is not supported.
- **One Jira account at a time.** Switching credentials in Settings clears
  the cached `accountId`; the next sync will refuse to run until it can
  re-resolve a fresh identity, to avoid silently filtering or deleting
  worklogs against the wrong user.
- **Token storage requires an OS keyring backend.** Headless Linux setups
  may need `gnome-keyring` or `kwallet` configured for the `keyring` crate.
- **Time precision.** Worklog hours are matched within one second of
  precision when adopting orphaned remote worklogs after a failed submit.

## Project layout

```
src/
  features/           Each feature owns components, repos, tests
    timesheet/        Week grid, cells, worklog sync
    favorites/        Pinned issues / groups
    issues/           Issue cache
    settings/         Jira credentials + logs panel
    palette/          Command palette
    gitCommits/       Local git scan
  jira/               Typed Jira REST client + errors
  ui/                 Shared chrome (AppLayout, ErrorBanner, ErrorBoundary)
  db/                 SQLite client wrapper

src-tauri/
  src/
    lib.rs            Tauri command surface
    db.rs             SQLite commands (with allowlist)
    jira.rs           HTTP proxy for Jira REST
    secure_storage.rs OS keyring integration
    git_scan.rs       Local git commit scanner
    migrations.rs     Append-only schema migrations
  capabilities/       Tauri v2 capability config
  tauri.conf.json     App config, CSP, bundle targets
```
