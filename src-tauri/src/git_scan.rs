use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    "vendor",
    "bin",
    "obj",
    ".cache",
    ".idea",
    ".vs",
];
const MAX_DEPTH: usize = 6;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanArgs {
    pub roots: Vec<String>,
    pub author_emails: Vec<String>,
    pub start_iso: String,
    pub end_iso: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub repo_path: String,
    pub repo_name: String,
    pub hash: String,
    pub date_iso: String,
    pub datetime_iso: String,
    pub author_email: String,
    pub message: String,
    pub ticket_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub commits: Vec<GitCommit>,
    pub scanned_repos: Vec<String>,
    pub errors: Vec<ScanError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanError {
    pub repo_path: String,
    pub message: String,
}

#[tauri::command]
pub fn scan_git_commits(args: ScanArgs) -> Result<ScanResult, String> {
    let emails: HashSet<String> = args
        .author_emails
        .iter()
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| !e.is_empty())
        .collect();
    if emails.is_empty() {
        return Err("No author emails configured.".into());
    }

    let mut repos: Vec<PathBuf> = Vec::new();
    let mut visited: HashSet<PathBuf> = HashSet::new();
    for root in &args.roots {
        let trimmed = root.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = PathBuf::from(trimmed);
        if !path.is_dir() {
            continue;
        }
        discover_repos(&path, 0, &mut repos, &mut visited);
    }

    let mut commits = Vec::new();
    let mut errors = Vec::new();
    let mut scanned = Vec::new();
    for repo in &repos {
        scanned.push(repo.display().to_string());
        match read_commits(repo, &args.start_iso, &args.end_iso, &emails) {
            Ok(mut c) => commits.append(&mut c),
            Err(message) => errors.push(ScanError {
                repo_path: repo.display().to_string(),
                message,
            }),
        }
    }

    Ok(ScanResult {
        commits,
        scanned_repos: scanned,
        errors,
    })
}

fn discover_repos(
    dir: &Path,
    depth: usize,
    repos: &mut Vec<PathBuf>,
    visited: &mut HashSet<PathBuf>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    if let Ok(canonical) = dir.canonicalize() {
        if !visited.insert(canonical) {
            return;
        }
    }
    if dir.join(".git").exists() {
        repos.push(dir.to_path_buf());
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }
        if is_reparse_point(&meta) {
            continue;
        }
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') && name != ".git" {
            continue;
        }
        if SKIP_DIRS.iter().any(|skip| *skip == name.as_str()) {
            continue;
        }
        discover_repos(&path, depth + 1, repos, visited);
    }
}

#[cfg(windows)]
fn is_reparse_point(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn read_commits(
    repo: &Path,
    start_iso: &str,
    end_iso: &str,
    emails: &HashSet<String>,
) -> Result<Vec<GitCommit>, String> {
    let since = format!("{} 00:00:00", start_iso);
    let until = format!("{} 23:59:59", end_iso);
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .arg("log")
        .arg("--all")
        .arg("--no-merges")
        .arg(format!("--since={}", since))
        .arg(format!("--until={}", until))
        .arg("--date=format-local:%Y-%m-%dT%H:%M:%S")
        .arg("--pretty=format:%H%x1f%ad%x1f%ae%x1f%B%x1e")
        .output()
        .map_err(|e| format!("git log failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "git log failed".to_string()
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let repo_path = repo.display().to_string();
    let repo_name = repo
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let mut commits = Vec::new();
    let mut seen_hashes: HashSet<String> = HashSet::new();
    for raw in stdout.split('\x1e') {
        let record = raw.trim_start_matches(['\n', '\r']);
        if record.is_empty() {
            continue;
        }
        let parts: Vec<&str> = record.splitn(4, '\x1f').collect();
        if parts.len() < 4 {
            continue;
        }
        let hash = parts[0].trim().to_string();
        let datetime = parts[1].trim().to_string();
        let email = parts[2].trim().to_ascii_lowercase();
        let message = parts[3].trim_end_matches('\n').to_string();
        if !emails.contains(&email) {
            continue;
        }
        if datetime.len() < 10 {
            continue;
        }
        let ticket_keys = extract_ticket_keys(&message);
        if ticket_keys.is_empty() {
            continue;
        }
        if !seen_hashes.insert(hash.clone()) {
            continue;
        }
        let date_iso = datetime[..10].to_string();
        commits.push(GitCommit {
            repo_path: repo_path.clone(),
            repo_name: repo_name.clone(),
            hash,
            date_iso,
            datetime_iso: datetime,
            author_email: email,
            message,
            ticket_keys,
        });
    }
    Ok(commits)
}

fn extract_ticket_keys(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut keys: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut i = 0;
    while i < bytes.len() {
        let is_boundary = i == 0 || {
            let c = bytes[i - 1];
            !(c.is_ascii_alphanumeric() || c == b'_')
        };
        if is_boundary && bytes[i].is_ascii_uppercase() {
            let start = i;
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j].is_ascii_uppercase() || bytes[j].is_ascii_digit()) {
                j += 1;
            }
            if j > start + 1 && j < bytes.len() && bytes[j] == b'-' {
                let dash = j;
                let mut k = dash + 1;
                while k < bytes.len() && bytes[k].is_ascii_digit() {
                    k += 1;
                }
                if k > dash + 1 {
                    let end_boundary = k == bytes.len() || {
                        let c = bytes[k];
                        !(c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                    };
                    if end_boundary {
                        if let Ok(slice) = std::str::from_utf8(&bytes[start..k]) {
                            let key = slice.to_string();
                            if seen.insert(key.clone()) {
                                keys.push(key);
                            }
                        }
                        i = k;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    keys
}

#[cfg(test)]
mod tests {
    use super::extract_ticket_keys;

    #[test]
    fn extracts_basic_keys() {
        let keys = extract_ticket_keys("ABC-1 fix something PROJ-123");
        assert_eq!(keys, vec!["ABC-1".to_string(), "PROJ-123".to_string()]);
    }

    #[test]
    fn dedupes_keys() {
        let keys = extract_ticket_keys("PROJ-1 PROJ-1 done");
        assert_eq!(keys, vec!["PROJ-1".to_string()]);
    }

    #[test]
    fn skips_lowercase() {
        let keys = extract_ticket_keys("abc-1 not a ticket");
        assert!(keys.is_empty());
    }

    #[test]
    fn requires_word_boundary() {
        let keys = extract_ticket_keys("fooABC-123 ABC-456bar ABC-789");
        assert_eq!(keys, vec!["ABC-789".to_string()]);
    }
}
