use serde::Serialize;
use serde_json::{Map, Number, Value};
use sqlx::sqlite::{SqliteArguments, SqliteQueryResult, SqliteRow};
use sqlx::{Column, Row, Sqlite, SqlitePool, TypeInfo, ValueRef};
use tauri::{AppHandle, Manager};

use crate::DB_URL;

type SqliteQuery<'q> = sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    rows_affected: u64,
    last_insert_id: i64,
}

#[tauri::command]
pub async fn db_execute(
    app: AppHandle,
    sql: String,
    params: Vec<Value>,
) -> Result<QueryResult, String> {
    let sql = normalize_sql(&sql);
    if !is_allowed_execute(&sql) {
        return Err("Database execute statement is not allowed.".to_string());
    }

    let pool = sqlite_pool(&app).await?;
    let query = bind_params(sqlx::query(&sql), params)?;
    let result: SqliteQueryResult = query
        .execute(&pool)
        .await
        .map_err(|err| format!("Could not execute database statement: {err}"))?;

    Ok(QueryResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_rowid(),
    })
}

#[tauri::command]
pub async fn db_select(
    app: AppHandle,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    let sql = normalize_sql(&sql);
    if !is_allowed_select(&sql) {
        return Err("Database select statement is not allowed.".to_string());
    }

    let pool = sqlite_pool(&app).await?;
    let query = bind_params(sqlx::query(&sql), params)?;
    let rows = query
        .fetch_all(&pool)
        .await
        .map_err(|err| format!("Could not select database rows: {err}"))?;

    rows.into_iter().map(row_to_json).collect()
}

async fn sqlite_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let db_url = sqlite_db_url(app)?;
    SqlitePool::connect(&db_url)
        .await
        .map_err(|err| format!("Could not open SQLite database: {err}"))
}

pub fn sqlite_db_url(app: &AppHandle) -> Result<String, String> {
    let mut path = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not resolve app data path: {err}"))?;
    std::fs::create_dir_all(&path)
        .map_err(|err| format!("Could not create app data directory: {err}"))?;
    let db_name = DB_URL
        .strip_prefix("sqlite:")
        .ok_or_else(|| "SQLite database URL is not configured.".to_string())?;
    path.push(db_name);
    Ok(format!("sqlite:{}", path.to_string_lossy()))
}

fn bind_params<'q>(
    mut query: SqliteQuery<'q>,
    params: Vec<Value>,
) -> Result<SqliteQuery<'q>, String> {
    for param in params {
        query = match param {
            Value::Null => query.bind(Option::<String>::None),
            Value::Bool(value) => query.bind(value),
            Value::Number(value) => bind_number(query, value)?,
            Value::String(value) => query.bind(value),
            Value::Array(_) | Value::Object(_) => {
                return Err("Database parameters must be scalar values.".to_string());
            }
        };
    }
    Ok(query)
}

fn bind_number<'q>(query: SqliteQuery<'q>, value: Number) -> Result<SqliteQuery<'q>, String> {
    if let Some(value) = value.as_i64() {
        return Ok(query.bind(value));
    }
    if let Some(value) = value.as_u64() {
        let value = i64::try_from(value)
            .map_err(|_| "Database integer parameter is too large.".to_string())?;
        return Ok(query.bind(value));
    }
    if let Some(value) = value.as_f64() {
        return Ok(query.bind(value));
    }
    Err("Database number parameter is not representable.".to_string())
}

fn row_to_json(row: SqliteRow) -> Result<Value, String> {
    let mut object = Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let value = column_to_json(&row, index)?;
        object.insert(column.name().to_string(), value);
    }
    Ok(Value::Object(object))
}

fn column_to_json(row: &SqliteRow, index: usize) -> Result<Value, String> {
    let raw = row
        .try_get_raw(index)
        .map_err(|err| format!("Could not read database column: {err}"))?;
    if raw.is_null() {
        return Ok(Value::Null);
    }

    let type_name = raw.type_info().name().to_ascii_uppercase();
    match type_name.as_str() {
        "INTEGER" | "INT" | "BIGINT" | "UNSIGNED BIG INT" | "INT8" => {
            let value: i64 = row
                .try_get(index)
                .map_err(|err| format!("Could not read integer column: {err}"))?;
            Ok(Value::Number(value.into()))
        }
        "REAL" | "DOUBLE" | "DOUBLE PRECISION" | "FLOAT" => {
            let value: f64 = row
                .try_get(index)
                .map_err(|err| format!("Could not read real column: {err}"))?;
            Number::from_f64(value)
                .map(Value::Number)
                .ok_or_else(|| "Database real column is not finite.".to_string())
        }
        _ => fallback_column_to_json(row, index),
    }
}

fn fallback_column_to_json(row: &SqliteRow, index: usize) -> Result<Value, String> {
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Ok(Value::String(value));
    }
    if let Ok(value) = row.try_get::<i64, _>(index) {
        return Ok(Value::Number(value.into()));
    }
    if let Ok(value) = row.try_get::<f64, _>(index) {
        return Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| "Database real column is not finite.".to_string());
    }
    Err("Database column type is not supported.".to_string())
}

fn normalize_sql(sql: &str) -> String {
    sql.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_allowed_execute(sql: &str) -> bool {
    ALLOWED_EXECUTE
        .iter()
        .any(|allowed| normalize_sql(allowed) == sql)
}

fn is_allowed_select(sql: &str) -> bool {
    ALLOWED_SELECT
        .iter()
        .any(|allowed| normalize_sql(allowed) == sql)
}

const ALLOWED_EXECUTE: &[&str] = &[
    "INSERT INTO app_meta(key, value) VALUES('schema_ready', '1') ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    "INSERT OR IGNORE INTO git_scan_roots (path) VALUES (?)",
    "DELETE FROM git_scan_roots WHERE path = ?",
    "INSERT OR IGNORE INTO week_picks (issue_key, week_start) VALUES (?, ?)",
    "DELETE FROM week_picks WHERE issue_key = ? AND week_start = ?",
    "INSERT INTO worklogs (issue_key, work_date, time_spent_hours, comment, sync_status) VALUES (?, ?, ?, ?, 'draft')",
    "UPDATE worklogs SET time_spent_hours = ?, comment = ?, sync_status = CASE sync_status WHEN 'submitted' THEN 'modified' ELSE sync_status END, updated_at = datetime('now') WHERE id = ?",
    "UPDATE worklogs SET jira_worklog_id = ?, sync_status = 'submitted', submit_attempts = 0, updated_at = datetime('now') WHERE id = ?",
    "UPDATE worklogs SET sync_status = 'submitted', submit_attempts = 0, updated_at = datetime('now') WHERE id = ?",
    "UPDATE worklogs SET submit_attempts = submit_attempts + 1 WHERE id = ?",
    "DELETE FROM worklogs WHERE id = ?",
    "UPDATE worklogs SET issue_key = ?, work_date = ?, time_spent_hours = ?, comment = ?, updated_at = datetime('now') WHERE id = ?",
    "INSERT INTO worklogs (issue_key, work_date, time_spent_hours, comment, jira_worklog_id, sync_status) VALUES (?, ?, ?, ?, ?, 'submitted')",
    "UPDATE worklogs SET sync_status = 'submitted', updated_at = datetime('now') WHERE id = ? AND sync_status = 'deleted' AND jira_worklog_id IS NOT NULL",
    "UPDATE worklogs SET sync_status = 'deleted', updated_at = datetime('now') WHERE id = ?",
    "INSERT INTO jira_issues (issue_key, summary, status, url, last_fetched_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(issue_key) DO UPDATE SET summary = excluded.summary, status = excluded.status, url = excluded.url, last_fetched_at = excluded.last_fetched_at",
    "INSERT OR IGNORE INTO jira_issues (issue_key, summary, status, url, last_fetched_at) VALUES (?, NULL, NULL, NULL, NULL)",
    "INSERT INTO jira_issues (issue_key, summary, status, url, last_fetched_at) VALUES (?, ?, ?, NULL, datetime('now')) ON CONFLICT(issue_key) DO UPDATE SET summary = excluded.summary, status = excluded.status, last_fetched_at = excluded.last_fetched_at",
    "UPDATE settings SET jira_base_url = ?, email = ?, api_token_ref = ?, updated_at = datetime('now') WHERE id = 1",
    "UPDATE settings SET jira_base_url = ?, email = ?, updated_at = datetime('now') WHERE id = 1",
    "INSERT INTO favorite_groups (name, sort_order) VALUES (?, ?)",
    "UPDATE favorite_groups SET name = ? WHERE id = ?",
    "DELETE FROM favorite_groups WHERE id = ?",
    "UPDATE favorite_groups SET sort_order = ? WHERE id = ?",
    "INSERT INTO favorite_issues (group_id, issue_key, sort_order) VALUES (NULL, ?, ?)",
    "INSERT INTO favorite_issues (group_id, issue_key, sort_order) VALUES (?, ?, ?)",
    "DELETE FROM favorite_issues WHERE id = ?",
    "DELETE FROM favorite_issues WHERE issue_key = ?",
    "UPDATE favorite_issues SET group_id = ?, sort_order = ? WHERE id = ?",
    "UPDATE favorite_issues SET group_id = NULL, sort_order = ? WHERE id = ?",
];

const ALLOWED_SELECT: &[&str] = &[
    "SELECT value FROM app_meta WHERE key = ?",
    "SELECT path, created_at FROM git_scan_roots ORDER BY created_at ASC, path ASC",
    "SELECT wp.id AS id, wp.issue_key AS issue_key, ji.summary AS summary, wp.week_start AS week_start, wp.created_at AS created_at FROM week_picks wp LEFT JOIN jira_issues ji ON ji.issue_key = wp.issue_key WHERE wp.week_start = ? ORDER BY wp.created_at ASC, wp.id ASC",
    "SELECT DISTINCT w.issue_key AS issue_key, ji.summary AS summary, ji.status AS status FROM worklogs w LEFT JOIN jira_issues ji ON ji.issue_key = w.issue_key WHERE w.work_date >= ? AND w.work_date <= ? ORDER BY w.issue_key ASC",
    "SELECT issue_key, work_date, SUM(time_spent_hours) AS total_hours FROM worklogs WHERE work_date >= ? AND work_date <= ? AND sync_status <> 'deleted' GROUP BY issue_key, work_date",
    "SELECT id, issue_key, work_date, time_spent_hours, comment, jira_worklog_id, sync_status, submit_attempts, created_at, updated_at FROM worklogs WHERE issue_key = ? AND work_date = ? ORDER BY CASE sync_status WHEN 'deleted' THEN 1 ELSE 0 END, created_at ASC, id ASC",
    "SELECT DISTINCT issue_key, work_date, sync_status FROM worklogs WHERE work_date >= ? AND work_date <= ? AND sync_status IN ('draft', 'modified', 'deleted')",
    "SELECT id, issue_key, work_date, time_spent_hours, comment, jira_worklog_id, sync_status, submit_attempts, created_at, updated_at FROM worklogs WHERE sync_status = 'draft' ORDER BY work_date ASC, created_at ASC, id ASC",
    "SELECT id, issue_key, work_date, time_spent_hours, comment, jira_worklog_id, sync_status, submit_attempts, created_at, updated_at FROM worklogs WHERE sync_status = 'modified' ORDER BY work_date ASC, created_at ASC, id ASC",
    "SELECT id, issue_key, work_date, time_spent_hours, comment, jira_worklog_id, sync_status, submit_attempts, created_at, updated_at FROM worklogs WHERE sync_status = 'deleted' ORDER BY work_date ASC, created_at ASC, id ASC",
    "SELECT id, sync_status FROM worklogs WHERE jira_worklog_id = ? LIMIT 1",
    "SELECT id, jira_worklog_id FROM worklogs WHERE issue_key = ? AND work_date >= ? AND work_date <= ? AND sync_status = 'submitted' AND jira_worklog_id IS NOT NULL",
    "SELECT sync_status, COUNT(*) AS n FROM worklogs WHERE sync_status IN ('draft', 'modified', 'deleted') GROUP BY sync_status",
    "SELECT sync_status FROM worklogs WHERE id = ?",
    "SELECT issue_key, summary, status, url, last_fetched_at FROM jira_issues WHERE issue_key = ?",
    "SELECT issue_key, summary, status, url, last_fetched_at FROM jira_issues ORDER BY last_fetched_at DESC, issue_key ASC LIMIT ?",
    "SELECT jira_base_url, email, api_token_ref, updated_at FROM settings WHERE id = 1",
    "SELECT g.id, g.name, g.sort_order, g.created_at, COALESCE((SELECT COUNT(*) FROM favorite_issues fi WHERE fi.group_id = g.id), 0) AS issue_count FROM favorite_groups g ORDER BY g.sort_order ASC, g.created_at ASC, g.id ASC",
    "SELECT id FROM favorite_groups WHERE name = ? COLLATE NOCASE",
    "SELECT MAX(sort_order) AS max_order FROM favorite_groups",
    "SELECT id FROM favorite_groups WHERE name = ? COLLATE NOCASE AND id <> ?",
    "SELECT COUNT(*) AS c FROM favorite_issues WHERE group_id = ?",
    "SELECT fi.id, fi.group_id, fi.issue_key, ji.summary, ji.status, ji.url, fi.sort_order, fi.created_at FROM favorite_issues fi LEFT JOIN jira_issues ji ON ji.issue_key = fi.issue_key WHERE fi.group_id = ? ORDER BY fi.sort_order ASC, fi.created_at ASC, fi.id ASC",
    "SELECT fi.id, fi.group_id, fi.issue_key, ji.summary, ji.status, ji.url, fi.sort_order, fi.created_at FROM favorite_issues fi LEFT JOIN jira_issues ji ON ji.issue_key = fi.issue_key LEFT JOIN favorite_groups g ON g.id = fi.group_id ORDER BY (fi.group_id IS NULL) ASC, g.sort_order ASC, g.id ASC, fi.sort_order ASC, fi.created_at ASC, fi.id ASC",
    "SELECT fi.id, fi.group_id, fi.issue_key, ji.summary, ji.status, ji.url, fi.sort_order, fi.created_at FROM favorite_issues fi LEFT JOIN jira_issues ji ON ji.issue_key = fi.issue_key WHERE fi.group_id IS NULL ORDER BY fi.sort_order ASC, fi.created_at ASC, fi.id ASC",
    "SELECT issue_key FROM jira_issues WHERE issue_key = ?",
    "SELECT id FROM favorite_issues WHERE issue_key = ? AND group_id IS NULL",
    "SELECT MAX(sort_order) AS max_order FROM favorite_issues WHERE group_id IS NULL",
    "SELECT id FROM favorite_groups WHERE id = ?",
    "SELECT id FROM favorite_issues WHERE group_id = ? AND issue_key = ?",
    "SELECT MAX(sort_order) AS max_order FROM favorite_issues WHERE group_id = ?",
    "SELECT id, group_id, issue_key FROM favorite_issues WHERE id = ?",
    "SELECT DISTINCT issue_key FROM favorite_issues",
    "SELECT id FROM favorite_issues WHERE issue_key = ? LIMIT 1",
];
