import { openUrl } from "@tauri-apps/plugin-opener";
import { getJiraCredentials } from "../features/settings/settingsRepo";
import { log } from "../log";
import { composeIssueUrl, isSafeIssueUrl } from "./issueUrl";

export async function openIssueInBrowser(issueKey: string): Promise<void> {
  const credentials = await getJiraCredentials();
  if (!credentials) {
    log.error(`Cannot open ${issueKey}: Jira credentials are not configured.`);
    return;
  }
  const url = composeIssueUrl(credentials.baseUrl, issueKey);
  if (!isSafeIssueUrl(url)) {
    log.error(`Refused to open unexpected issue URL scheme/host: ${url}`);
    return;
  }
  try {
    await openUrl(url);
  } catch (cause) {
    log.error(`Failed to open ${issueKey} in browser`, cause);
  }
}
