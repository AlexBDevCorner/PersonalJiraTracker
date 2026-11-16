use std::process::Command;

// Paths and exclusions are positional arguments, never interpolated into shell code.
const DISCOVER_SCRIPT: &str = r#"
set -eu
root=$1
max_depth=$2
shift 2
if [ ! -d "$root" ] || [ ! -r "$root" ] || [ ! -x "$root" ]; then
    printf 'Cannot read WSL folder: %s\n' "$root" >&2
    exit 1
fi
cd -P -- "$root"
scan() (
    dir=$1
    depth=$2
    shift 2
    if [ -e "$dir/.git" ]; then
        printf '%s\0' "$dir"
        return
    fi
    [ "$depth" -lt "$max_depth" ] || return 0
    for child in "${dir%/}"/*; do
        [ -d "$child" ] && [ ! -L "$child" ] || continue
        name=${child##*/}
        for skip in "$@"; do
            if [ "$name" = "$skip" ]; then continue 2; fi
        done
        scan "$child" "$((depth + 1))" "$@"
    done
)
scan "$PWD" 0 "$@"
"#;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WslPath {
    pub distribution: String,
    pub linux_path: String,
}

impl WslPath {
    pub fn parse(path: &str) -> Result<Option<Self>, String> {
        let normalized = path.replace('\\', "/");
        let Some(unc) = normalized.strip_prefix("//") else {
            return Ok(None);
        };
        let mut parts = unc.splitn(3, '/');
        let host = parts.next().unwrap_or("");
        if !host.eq_ignore_ascii_case("wsl$") && !host.eq_ignore_ascii_case("wsl.localhost") {
            return Ok(None);
        }
        let distribution = parts.next().unwrap_or("");
        if distribution.is_empty()
            || distribution == "."
            || distribution == ".."
            || distribution.starts_with('-')
            || distribution.chars().any(char::is_control)
        {
            return Err(
                "Specify a WSL distribution, for example \\\\wsl$\\Ubuntu\\home\\you.".into(),
            );
        }
        let suffix = parts.next().unwrap_or("").trim_matches('/');
        Ok(Some(Self {
            distribution: distribution.to_string(),
            linux_path: format!("/{suffix}"),
        }))
    }

    pub fn display(&self) -> String {
        format!(
            "\\\\wsl.localhost\\{}{}",
            self.distribution,
            self.linux_path.replace('/', "\\")
        )
    }

    pub fn command(&self, program: &str) -> Command {
        let mut cmd = Command::new("wsl.exe");
        // Avoid inheriting a Windows working directory that cannot be mapped into WSL.
        cmd.args([
            "--distribution",
            &self.distribution,
            "--cd",
            "/",
            "--exec",
            program,
        ]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(super::CREATE_NO_WINDOW);
        }
        cmd
    }

    pub fn discover(&self, max_depth: usize, skip_dirs: &[&str]) -> Result<Vec<Self>, String> {
        let output = self
            .command("sh")
            .args(["-c", DISCOVER_SCRIPT, "git-scan", &self.linux_path])
            .arg(max_depth.to_string())
            .args(skip_dirs)
            .output()
            .map_err(|e| format!("Could not scan WSL distribution {}: {e}", self.distribution))?;
        if !output.status.success() {
            let detail = if output.stderr.is_empty() {
                &output.stdout
            } else {
                &output.stderr
            };
            return Err(format!(
                "WSL repository discovery failed in {}: {}",
                self.distribution,
                String::from_utf8_lossy(detail).replace('\0', "").trim()
            ));
        }
        let stdout = String::from_utf8(output.stdout)
            .map_err(|_| "WSL repository paths are not valid UTF-8.".to_string())?;
        Ok(stdout
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(|path| Self {
                distribution: self.distribution.clone(),
                linux_path: path.to_string(),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_wsl_hosts_and_preserves_linux_case_and_spaces() {
        for path in [
            r"\\wsl$\Ubuntu-24.04\home\Bob\My Repo\",
            "//WSL.LOCALHOST/Ubuntu-24.04/home/Bob/My Repo/",
        ] {
            let parsed = WslPath::parse(path).unwrap().unwrap();
            assert_eq!(parsed.distribution, "Ubuntu-24.04");
            assert_eq!(parsed.linux_path, "/home/Bob/My Repo");
            assert_eq!(
                parsed.display(),
                r"\\wsl.localhost\Ubuntu-24.04\home\Bob\My Repo"
            );
        }
    }

    #[test]
    fn leaves_native_and_other_network_paths_alone() {
        for path in [
            r"C:\repos",
            "/home/bobale",
            r"\\server\share",
            "//wsl.example/Ubuntu",
        ] {
            assert_eq!(WslPath::parse(path).unwrap(), None);
        }
    }

    #[test]
    fn accepts_distribution_root_and_rejects_missing_distribution() {
        assert_eq!(
            WslPath::parse(r"\\wsl$\Ubuntu")
                .unwrap()
                .unwrap()
                .linux_path,
            "/"
        );
        for path in [
            r"\\wsl$",
            r"\\wsl.localhost\",
            r"\\wsl$\..\home",
            r"\\wsl$\--exec",
        ] {
            assert!(WslPath::parse(path).is_err(), "{path}");
        }
    }

    #[test]
    fn runs_git_in_the_selected_distribution_without_shell_interpolation() {
        let path = WslPath::parse(r"\\wsl$\Ubuntu\home\a b\$(touch nope);'repo")
            .unwrap()
            .unwrap();
        let mut command = path.command("git");
        command.args(["-C", &path.linux_path, "log"]);
        assert_eq!(command.get_program(), "wsl.exe");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![
                "--distribution",
                "Ubuntu",
                "--cd",
                "/",
                "--exec",
                "git",
                "-C",
                "/home/a b/$(touch nope);'repo",
                "log",
            ]
        );
    }
}
