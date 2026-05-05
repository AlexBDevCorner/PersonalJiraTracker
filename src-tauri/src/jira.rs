use std::collections::HashMap;

use base64::{engine::general_purpose, Engine as _};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::secure_storage;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraRequest {
    base_url: String,
    email: String,
    api_token_ref: String,
    path: String,
    method: Option<String>,
    query: Option<HashMap<String, Value>>,
    body: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraCommandError {
    kind: &'static str,
    message: String,
    status: Option<u16>,
    body: Option<Value>,
}

impl JiraCommandError {
    fn config(message: impl Into<String>) -> Self {
        Self {
            kind: "config",
            message: message.into(),
            status: None,
            body: None,
        }
    }

    fn network(message: impl Into<String>) -> Self {
        Self {
            kind: "network",
            message: message.into(),
            status: None,
            body: None,
        }
    }

    fn api(status: u16, message: impl Into<String>, body: Option<Value>) -> Self {
        let kind = match status {
            401 => "auth",
            403 => "forbidden",
            404 => "not_found",
            _ => "api",
        };
        Self {
            kind,
            message: message.into(),
            status: Some(status),
            body,
        }
    }
}

#[tauri::command]
pub async fn jira_request(request: JiraRequest) -> Result<Value, JiraCommandError> {
    let url = build_url(&request.base_url, &request.path, request.query.as_ref())?;
    let method = request.method.as_deref().unwrap_or("GET");
    let method = method
        .parse::<reqwest::Method>()
        .map_err(|_| JiraCommandError::config("Jira request method is not valid."))?;
    let token = secure_storage::get_jira_api_token(&request.api_token_ref)
        .map_err(|err| JiraCommandError::config(err.message().to_string()))?;
    let auth_header = format!(
        "Basic {}",
        general_purpose::STANDARD.encode(format!("{}:{token}", request.email))
    );

    let client = reqwest::Client::new();
    let mut builder = client
        .request(method.clone(), url)
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, auth_header);

    if let Some(body) = request.body {
        builder = builder.header(CONTENT_TYPE, "application/json").json(&body);
    }

    let response = builder
        .send()
        .await
        .map_err(|err| JiraCommandError::network(format!("Could not reach Jira: {err}")))?;
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let text = response
        .text()
        .await
        .map_err(|err| JiraCommandError::network(format!("Could not read Jira response: {err}")))?;
    let body = parse_response_body(status.as_u16(), &content_type, &text);

    if !status.is_success() {
        let message = extract_jira_message(body.as_ref()).unwrap_or_else(|| {
            format!(
                "Jira {} {} failed with status {}.",
                method,
                request.path,
                status.as_u16()
            )
        });
        return Err(JiraCommandError::api(status.as_u16(), message, body));
    }

    Ok(body.unwrap_or(Value::Null))
}

fn build_url(
    base_url: &str,
    path: &str,
    query: Option<&HashMap<String, Value>>,
) -> Result<reqwest::Url, JiraCommandError> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err(JiraCommandError::config("Jira base URL is not configured."));
    }

    let parsed = reqwest::Url::parse(trimmed).map_err(|_| {
        JiraCommandError::config(format!("Jira base URL is not a valid URL: \"{base_url}\"."))
    })?;
    if parsed.scheme() != "https" {
        return Err(JiraCommandError::config(format!(
            "Jira Cloud base URL must use https (got \"{}:\").",
            parsed.scheme()
        )));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| JiraCommandError::config("Jira base URL must include a host."))?;
    if !is_allowed_jira_cloud_host(host) {
        return Err(JiraCommandError::config(
            "Jira Cloud base URL must be an atlassian.net host.",
        ));
    }
    let host = match parsed.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    let base = format!(
        "{}://{}{}",
        parsed.scheme(),
        host,
        parsed.path().trim_end_matches('/')
    );
    let clean_path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let mut url = reqwest::Url::parse(&(base + &clean_path)).map_err(|_| {
        JiraCommandError::config(
            "Jira request URL could not be built from the configured base URL.",
        )
    })?;

    if let Some(query) = query {
        let mut pairs = url.query_pairs_mut();
        for (key, value) in query {
            if value.is_null() {
                continue;
            }
            pairs.append_pair(key, &query_value_to_string(value));
        }
    }

    Ok(url)
}

fn is_allowed_jira_cloud_host(host: &str) -> bool {
    host.to_ascii_lowercase().ends_with(".atlassian.net")
}

fn query_value_to_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        other => other.to_string(),
    }
}

fn parse_response_body(status: u16, content_type: &str, text: &str) -> Option<Value> {
    if status == 204 || text.is_empty() {
        return None;
    }
    if content_type.contains("application/json") {
        return serde_json::from_str(text)
            .map(Some)
            .unwrap_or_else(|_| Some(Value::String(text.to_string())));
    }
    Some(Value::String(text.to_string()))
}

fn extract_jira_message(body: Option<&Value>) -> Option<String> {
    let obj = body?.as_object()?;
    if let Some(messages) = obj.get("errorMessages").and_then(|value| value.as_array()) {
        let values = messages
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        if !values.is_empty() {
            return Some(values.join(" "));
        }
    }
    if let Some(errors) = obj.get("errors").and_then(|value| value.as_object()) {
        let values = errors
            .values()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>();
        if !values.is_empty() {
            return Some(values.join(" "));
        }
    }
    obj.get("message")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
}
