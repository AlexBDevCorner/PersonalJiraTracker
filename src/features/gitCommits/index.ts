export { GitCommitsPanel } from "./GitCommitsPanel";
export { GitFoldersSettings } from "./GitFoldersSettings";
export { scanGitCommits } from "./api";
export {
  listScanRoots,
  addScanRoot,
  removeScanRoot,
  type ScanRoot,
} from "./scanRootsRepo";
export {
  getAuthorEmails,
  setAuthorEmails,
  splitEmails,
} from "./authorEmailsRepo";
export type { GitCommitRecord, GitScanArgs, GitScanResult } from "./types";
