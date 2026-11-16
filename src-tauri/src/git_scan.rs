use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};

#[cfg(any(windows, test))]
mod wsl;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

enum Repository {
    Local(PathBuf),
    #[cfg(windows)]
    Wsl(wsl::WslPath),
}

impl Repository {
    fn display_path(&self) -> String {
        match self {
            Self::Local(path) => path.display().to_string(),
            #[cfg(windows)]
            Self::Wsl(path) => path.display(),
        }
    }

    fn name(&self) -> String {
        match self {
            Self::Local(path) => path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string(),
            #[cfg(windows)]
            Self::Wsl(path) => path.linux_path.rsplit('/').next().unwrap_or("").to_string(),
        }
    }

    fn git_command(&self) -> Command {
        match self {
            Self::Local(path) => {
                let mut cmd = Command::new("git");
                #[cfg(windows)]
                cmd.creation_flags(CREATE_NO_WINDOW);
                cmd.arg("-C").arg(path);
                cmd
            }
            #[cfg(windows)]
            Self::Wsl(path) => {
                let mut cmd = path.command("git");
                cmd.arg("-C").arg(&path.linux_path);
                cmd
            }
        }
    }
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

    let mut repos = Vec::new();
    let mut errors = Vec::new();
    let mut visited: HashSet<PathBuf> = HashSet::new();
    #[cfg(windows)]
    let mut visited_wsl = HashSet::new();
    for root in &args.roots {
        let trimmed = root.trim();
        if trimmed.is_empty() {
            continue;
        }
        #[cfg(windows)]
        match wsl::WslPath::parse(trimmed) {
            Ok(Some(root)) => {
                match root.discover(MAX_DEPTH, SKIP_DIRS) {
                    Ok(found) => {
                        for repo in found {
                            if visited_wsl.insert(repo.clone()) {
                                repos.push(Repository::Wsl(repo));
                            }
                        }
                    }
                    Err(message) => errors.push(ScanError {
                        repo_path: trimmed.to_string(),
                        message,
                    }),
                }
                continue;
            }
            Err(message) => {
                errors.push(ScanError {
                    repo_path: trimmed.to_string(),
                    message,
                });
                continue;
            }
            Ok(None) => {}
        }
        let path = PathBuf::from(trimmed);
        if !path.is_dir() {
            errors.push(ScanError {
                repo_path: trimmed.to_string(),
                message: "Folder does not exist or is inaccessible.".into(),
            });
            continue;
        }
        let mut local_repos = Vec::new();
        discover_repos(&path, 0, &mut local_repos, &mut visited);
        repos.extend(local_repos.into_iter().map(Repository::Local));
    }

    let mut commits = Vec::new();
    let mut scanned = Vec::new();
    for repo in &repos {
        scanned.push(repo.display_path());
        match read_commits(repo, &args.start_iso, &args.end_iso, &emails) {
            Ok(mut c) => commits.append(&mut c),
            Err(message) => errors.push(ScanError {
                repo_path: repo.display_path(),
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
    repo: &Repository,
    start_iso: &str,
    end_iso: &str,
    emails: &HashSet<String>,
) -> Result<Vec<GitCommit>, String> {
    let since = format!("{} 00:00:00", start_iso);
    let until = format!("{} 23:59:59", end_iso);
    let mut cmd = repo.git_command();
    let output = cmd
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
        let detail = if output.stderr.is_empty() {
            &output.stdout
        } else {
            &output.stderr
        };
        let stderr = String::from_utf8_lossy(detail)
            .replace('\0', "")
            .trim()
            .to_string();
        return Err(if stderr.is_empty() {
            "git log failed".to_string()
        } else {
            stderr
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let repo_path = repo.display_path();
    let repo_name = repo.name();
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
    use super::*;

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

    #[test]
    fn native_repositories_use_host_git() {
        let path = PathBuf::from("repos").join("My Repo");
        let repo = Repository::Local(path.clone());
        let command = repo.git_command();
        assert_eq!(command.get_program(), "git");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![std::ffi::OsStr::new("-C"), path.as_os_str(),]
        );
        assert_eq!(repo.name(), "My Repo");
    }

    #[test]
    fn reports_missing_scan_roots() {
        let missing = std::env::temp_dir()
            .join(format!(
                "jira-missing-root-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
            ))
            .display()
            .to_string();
        let result = scan_git_commits(ScanArgs {
            roots: vec![missing.clone()],
            author_emails: vec!["test@example.com".into()],
            start_iso: "2026-11-02".into(),
            end_iso: "2026-11-08".into(),
        })
        .unwrap();
        assert!(result.scanned_repos.is_empty());
        assert_eq!(result.errors.len(), 1);
        assert_eq!(result.errors[0].repo_path, missing);
        assert!(result.errors[0].message.contains("inaccessible"));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires WSL with Ubuntu and Git; optionally set WSL_TEST_DISTRIBUTION"]
    fn scans_wsl_repositories_and_worktrees_with_native_roots() {
        struct Fixture(wsl::WslPath, PathBuf);
        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = self
                    .0
                    .command("rm")
                    .args(["-rf", "--", &self.0.linux_path])
                    .output();
                let _ = std::fs::remove_dir_all(&self.1);
            }
        }
        let mut root = wsl::WslPath {
            distribution: std::env::var("WSL_TEST_DISTRIBUTION")
                .unwrap_or_else(|_| "Ubuntu".into()),
            linux_path: "/tmp".into(),
        };
        let output = root
            .command("mktemp")
            .args(["-d", "/tmp/jira-git-scan-test.XXXXXX"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        root.linux_path = String::from_utf8(output.stdout).unwrap().trim().to_string();
        let native_root = std::env::temp_dir().join(root.linux_path.rsplit('/').next().unwrap());
        let fixture = Fixture(root, native_root);
        let root = &fixture.0;
        let setup = r#"
set -eu
root=$1
repo="$root/Repo with spaces; 'quotes' \$(touch SHOULD_NOT_EXIST)"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME=Scanner GIT_COMMITTER_NAME=Scanner
export GIT_AUTHOR_EMAIL=scan@example.com GIT_COMMITTER_EMAIL=scan@example.com
export GIT_AUTHOR_DATE=2026-11-02T12:00:00+0000 GIT_COMMITTER_DATE=2026-11-02T12:00:00+0000
git init -q "$repo"
GIT_AUTHOR_DATE=2026-01-01T12:00:00+0000 GIT_COMMITTER_DATE=2026-01-01T12:00:00+0000 \
    git -C "$repo" commit -q --allow-empty -m 'APP-99 outside the week'
git -C "$repo" commit -q --allow-empty -m 'APP-1 matching commit'
GIT_AUTHOR_EMAIL=someone@example.com git -C "$repo" commit -q --allow-empty -m 'APP-2 different author'
git -C "$repo" commit -q --allow-empty -m 'No issue key'
git -C "$repo" worktree add -qb scan-test "$root/worktree"
git -C "$root/worktree" commit -q --allow-empty -m 'APP-3 worktree commit'
mkdir -p "$root/node_modules/ignored/.git" "$root/.hidden/ignored/.git" \
    "$root/one/two/three/four/five/six/seven/.git" "$repo/nested/.git"
ln -s "$root" "$root/cycle"
"#;
        let output = root
            .command("sh")
            .args(["-c", setup, "git-scan-test", &root.linux_path])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );

        std::fs::create_dir(&fixture.1).unwrap();
        let native_repo = Repository::Local(fixture.1.clone());
        let output = native_repo
            .git_command()
            .args(["init", "--quiet"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = native_repo
            .git_command()
            .env("GIT_CONFIG_GLOBAL", "NUL")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_DATE", "2026-11-02T12:00:00+0000")
            .env("GIT_COMMITTER_DATE", "2026-11-02T12:00:00+0000")
            .args([
                "-c",
                "user.name=Scanner",
                "-c",
                "user.email=scan@example.com",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "--quiet",
                "--allow-empty",
                "-m",
                "APP-4 native commit",
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let missing = format!("{}\\missing", root.display());
        let args = ScanArgs {
            // Both WSL aliases and overlapping roots must not duplicate a repository.
            roots: vec![
                root.display(),
                root.display().replace("wsl.localhost", "wsl$"),
                format!("{}\\worktree", root.display()),
                native_repo.display_path(),
                missing.clone(),
            ],
            author_emails: vec![" SCAN@EXAMPLE.COM ".into()],
            start_iso: "2026-11-02".into(),
            end_iso: "2026-11-08".into(),
        };
        let result = scan_git_commits(args).unwrap();
        assert_eq!(result.scanned_repos.len(), 3, "{:?}", result.scanned_repos);
        assert_eq!(result.errors.len(), 1, "{:?}", result.errors);
        assert_eq!(result.errors[0].repo_path, missing);
        assert!(result.errors[0].message.contains("Cannot read WSL folder"));
        assert_eq!(result.commits.len(), 5, "{:?}", result.commits);
        assert!(result
            .commits
            .iter()
            .any(|c| c.repo_path == native_repo.display_path() && c.ticket_keys == ["APP-4"]));
        for repo in result
            .scanned_repos
            .iter()
            .filter(|p| p.starts_with(r"\\wsl.localhost\"))
        {
            let commits: Vec<_> = result
                .commits
                .iter()
                .filter(|c| &c.repo_path == repo)
                .collect();
            assert_eq!(commits.len(), 2);
            assert!(commits.iter().any(|c| c.ticket_keys == ["APP-1"]));
            assert!(commits.iter().any(|c| c.ticket_keys == ["APP-3"]));
        }
    }
}
