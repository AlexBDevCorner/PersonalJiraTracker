mod db;
mod git_scan;
mod jira;
mod migrations;
mod secure_storage;

pub const DB_URL: &str = "sqlite:jira_tracker.db";

#[tauri::command]
fn db_url() -> &'static str {
    DB_URL
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations::migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            db_url,
            db::db_execute,
            db::db_select,
            git_scan::scan_git_commits,
            jira::jira_request,
            secure_storage::migrate_jira_api_token,
            secure_storage::save_jira_api_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
