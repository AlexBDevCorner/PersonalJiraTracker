export type GitCommitRecord = {
  repoPath: string;
  repoName: string;
  hash: string;
  dateIso: string;
  datetimeIso: string;
  authorEmail: string;
  message: string;
  ticketKeys: string[];
};

export type GitScanResult = {
  commits: GitCommitRecord[];
  scannedRepos: string[];
  errors: { repoPath: string; message: string }[];
};

export type GitScanArgs = {
  roots: string[];
  authorEmails: string[];
  startIso: string;
  endIso: string;
};
