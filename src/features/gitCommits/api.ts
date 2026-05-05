import { invoke } from "@tauri-apps/api/core";
import type { GitScanArgs, GitScanResult } from "./types";

export async function scanGitCommits(args: GitScanArgs): Promise<GitScanResult> {
  return await invoke<GitScanResult>("scan_git_commits", { args });
}
