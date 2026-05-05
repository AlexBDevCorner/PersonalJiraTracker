use keyring::Entry;
use serde::Serialize;
use tauri::AppHandle;

use crate::db::sqlite_db_url;

pub const JIRA_API_TOKEN_REF: &str = "jira:default";

const KEYRING_SERVICE: &str = "JiraTicketTracker";

#[derive(Debug, Serialize)]
pub struct SecureStorageError {
    message: String,
}

impl SecureStorageError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

#[tauri::command]
pub fn save_jira_api_token(token: String) -> Result<String, SecureStorageError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(SecureStorageError::new("Jira API token cannot be empty."));
    }

    store_jira_api_token(token)?;

    Ok(JIRA_API_TOKEN_REF.to_string())
}

#[tauri::command]
pub async fn migrate_jira_api_token(app: AppHandle) -> Result<(), SecureStorageError> {
    let db_url = sqlite_db_url_for_secure_storage(&app)?;
    let pool = sqlx::SqlitePool::connect(&db_url)
        .await
        .map_err(|err| SecureStorageError::new(format!("Could not open SQLite settings: {err}")))?;
    let row =
        sqlx::query_as::<_, (Option<String>,)>("SELECT api_token_ref FROM settings WHERE id = 1")
            .fetch_optional(&pool)
            .await
            .map_err(|err| {
                SecureStorageError::new(format!("Could not read Jira token reference: {err}"))
            })?;

    let Some((Some(value),)) = row else {
        return Ok(());
    };
    if value == JIRA_API_TOKEN_REF {
        return Ok(());
    }

    store_jira_api_token(&value)?;
    sqlx::query("UPDATE settings SET api_token_ref = ?, updated_at = datetime('now') WHERE id = 1")
        .bind(JIRA_API_TOKEN_REF)
        .execute(&pool)
        .await
        .map_err(|err| {
            SecureStorageError::new(format!(
                "Could not replace plaintext Jira token reference: {err}"
            ))
        })?;

    Ok(())
}

pub fn get_jira_api_token(token_ref: &str) -> Result<String, SecureStorageError> {
    entry_for_ref(token_ref)?.get_password().map_err(|err| {
        SecureStorageError::new(format!(
            "Could not read Jira API token from OS credential storage: {err}"
        ))
    })
}

fn store_jira_api_token(token: &str) -> Result<(), SecureStorageError> {
    entry_for_ref(JIRA_API_TOKEN_REF)?
        .set_password(token)
        .map_err(|err| {
            SecureStorageError::new(format!(
                "Could not save Jira API token to OS credential storage: {err}"
            ))
        })
}

fn entry_for_ref(token_ref: &str) -> Result<Entry, SecureStorageError> {
    if token_ref != JIRA_API_TOKEN_REF {
        return Err(SecureStorageError::new(
            "Jira API token reference is not recognized.",
        ));
    }

    Entry::new(KEYRING_SERVICE, token_ref).map_err(|err| {
        SecureStorageError::new(format!(
            "Could not open OS credential storage for Jira API token: {err}"
        ))
    })
}

fn sqlite_db_url_for_secure_storage(app: &AppHandle) -> Result<String, SecureStorageError> {
    sqlite_db_url(app).map_err(SecureStorageError::new)
}
