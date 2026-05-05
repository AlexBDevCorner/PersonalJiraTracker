// Module-local cache for the signed-in Jira account ID. Keyed by credential
// identity (base URL + email) so a Settings change does not let a previously
// resolved accountId leak into syncs run with new credentials — that would
// silently filter the new user's worklogs out and trigger destructive
// reconciliation on the wrong identity.

type Entry = { key: string; accountId: string };

let entry: Entry | null = null;

export function makeAccountIdCacheKey(baseUrl: string, email: string): string {
  return `${baseUrl.trim().toLowerCase()}|${email.trim().toLowerCase()}`;
}

export function getCachedAccountId(key: string): string | null {
  return entry && entry.key === key ? entry.accountId : null;
}

export function setCachedAccountId(key: string, accountId: string): void {
  entry = { key, accountId };
}

export function invalidateAccountIdCache(): void {
  entry = null;
}
