export function composeIssueUrl(baseUrl: string, issueKey: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}/browse/${encodeURIComponent(issueKey)}`;
}

// Defense-in-depth: openUrl will hand any string to the OS — including file:
// or custom-protocol schemes. Reject anything that isn't an https Atlassian
// URL before opening.
export function isSafeIssueUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return url.hostname.toLowerCase().endsWith(".atlassian.net");
  } catch {
    return false;
  }
}
