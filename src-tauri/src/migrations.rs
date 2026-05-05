use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_app_meta",
            sql: "CREATE TABLE IF NOT EXISTS app_meta (\
                    key TEXT PRIMARY KEY NOT NULL,\
                    value TEXT NOT NULL,\
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))\
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_domain_schema",
            sql: DOMAIN_SCHEMA_V2,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "track_worklog_submit_attempts",
            sql: "ALTER TABLE worklogs ADD COLUMN submit_attempts INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_week_picks",
            sql: "CREATE TABLE IF NOT EXISTS week_picks (\
                    id INTEGER PRIMARY KEY AUTOINCREMENT,\
                    issue_key TEXT NOT NULL,\
                    week_start TEXT NOT NULL,\
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),\
                    UNIQUE(issue_key, week_start)\
                  );\
                  CREATE INDEX IF NOT EXISTS idx_week_picks_week ON week_picks(week_start);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_git_scan_roots",
            sql: "CREATE TABLE IF NOT EXISTS git_scan_roots (\
                    path TEXT PRIMARY KEY NOT NULL,\
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))\
                  );",
            kind: MigrationKind::Up,
        },
        // Allow ungrouped favorites by recreating favorite_issues with a
        // nullable group_id. tauri-plugin-sql's migration runner is flaky with
        // multi-statement SQL containing INSERT...SELECT + ALTER RENAME, so
        // each step is its own migration. v6 wipes any stale partial state
        // from earlier (broken) attempts of this migration.
        Migration {
            version: 6,
            description: "fav_nullable_group_cleanup",
            sql: "DROP TABLE IF EXISTS favorite_issues_new",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "fav_nullable_group_create",
            sql: "CREATE TABLE favorite_issues_new (\
                    id INTEGER PRIMARY KEY AUTOINCREMENT,\
                    group_id INTEGER REFERENCES favorite_groups(id) ON DELETE CASCADE,\
                    issue_key TEXT NOT NULL REFERENCES jira_issues(issue_key) ON DELETE CASCADE,\
                    sort_order INTEGER NOT NULL DEFAULT 0,\
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),\
                    UNIQUE(group_id, issue_key)\
                  )",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "fav_nullable_group_copy",
            sql: "INSERT INTO favorite_issues_new (id, group_id, issue_key, sort_order, created_at) \
                  SELECT id, group_id, issue_key, sort_order, created_at FROM favorite_issues",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "fav_nullable_group_drop_old",
            sql: "DROP TABLE favorite_issues",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "fav_nullable_group_rename",
            sql: "ALTER TABLE favorite_issues_new RENAME TO favorite_issues",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "fav_nullable_group_index_group",
            sql: "CREATE INDEX IF NOT EXISTS idx_favorite_issues_group \
                  ON favorite_issues(group_id)",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "fav_nullable_group_index_ungrouped",
            sql: "CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_issues_ungrouped \
                  ON favorite_issues(issue_key) WHERE group_id IS NULL",
            kind: MigrationKind::Up,
        },
    ]
}

const DOMAIN_SCHEMA_V2: &str = "\
CREATE TABLE IF NOT EXISTS settings (\
    id INTEGER PRIMARY KEY CHECK (id = 1),\
    jira_base_url TEXT,\
    email TEXT,\
    api_token_ref TEXT,\
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))\
);\
INSERT OR IGNORE INTO settings (id) VALUES (1);\
\
CREATE TABLE IF NOT EXISTS jira_issues (\
    issue_key TEXT PRIMARY KEY NOT NULL,\
    summary TEXT,\
    status TEXT,\
    url TEXT,\
    last_fetched_at TEXT\
);\
\
CREATE TABLE IF NOT EXISTS favorite_groups (\
    id INTEGER PRIMARY KEY AUTOINCREMENT,\
    name TEXT NOT NULL,\
    sort_order INTEGER NOT NULL DEFAULT 0,\
    created_at TEXT NOT NULL DEFAULT (datetime('now'))\
);\
\
CREATE TABLE IF NOT EXISTS favorite_issues (\
    id INTEGER PRIMARY KEY AUTOINCREMENT,\
    group_id INTEGER NOT NULL REFERENCES favorite_groups(id) ON DELETE CASCADE,\
    issue_key TEXT NOT NULL REFERENCES jira_issues(issue_key) ON DELETE CASCADE,\
    sort_order INTEGER NOT NULL DEFAULT 0,\
    created_at TEXT NOT NULL DEFAULT (datetime('now')),\
    UNIQUE(group_id, issue_key)\
);\
CREATE INDEX IF NOT EXISTS idx_favorite_issues_group ON favorite_issues(group_id);\
\
CREATE TABLE IF NOT EXISTS worklogs (\
    id INTEGER PRIMARY KEY AUTOINCREMENT,\
    issue_key TEXT NOT NULL,\
    work_date TEXT NOT NULL,\
    time_spent_hours REAL NOT NULL,\
    comment TEXT NOT NULL,\
    jira_worklog_id TEXT,\
    sync_status TEXT NOT NULL CHECK (sync_status IN ('draft','submitted','modified','deleted')),\
    created_at TEXT NOT NULL DEFAULT (datetime('now')),\
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))\
);\
CREATE INDEX IF NOT EXISTS idx_worklogs_issue_date ON worklogs(issue_key, work_date);\
CREATE INDEX IF NOT EXISTS idx_worklogs_sync_status ON worklogs(sync_status);\
CREATE INDEX IF NOT EXISTS idx_worklogs_jira_id ON worklogs(jira_worklog_id);\
";

#[cfg(test)]
mod tests {
    use super::migrations;

    #[test]
    fn migrations_are_ordered_and_unique() {
        let migrations = migrations();
        let versions: Vec<i64> = migrations.iter().map(|migration| migration.version).collect();

        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    }

    #[test]
    fn nullable_favorite_group_migration_allows_ungrouped_favorites() {
        let migrations = migrations();
        let create = migrations
            .iter()
            .find(|migration| migration.version == 7)
            .expect("version 7 migration should create replacement favorite_issues table");

        assert!(create.sql.contains("CREATE TABLE favorite_issues_new"));
        assert!(create
            .sql
            .contains("group_id INTEGER REFERENCES favorite_groups(id) ON DELETE CASCADE"));
        assert!(!create.sql.contains("group_id INTEGER NOT NULL"));
    }

    #[test]
    fn nullable_favorite_group_migration_preserves_data_and_indexes_ungrouped_uniqueness() {
        let migrations = migrations();
        let copy = migrations
            .iter()
            .find(|migration| migration.version == 8)
            .expect("version 8 migration should copy old favorite issues");
        let ungrouped_index = migrations
            .iter()
            .find(|migration| migration.version == 12)
            .expect("version 12 migration should index ungrouped favorites");

        assert!(copy.sql.contains(
            "INSERT INTO favorite_issues_new (id, group_id, issue_key, sort_order, created_at)"
        ));
        assert!(copy.sql.contains("SELECT id, group_id, issue_key, sort_order, created_at"));
        assert!(ungrouped_index
            .sql
            .contains("CREATE UNIQUE INDEX IF NOT EXISTS idx_favorite_issues_ungrouped"));
        assert!(ungrouped_index.sql.contains("WHERE group_id IS NULL"));
    }
}
