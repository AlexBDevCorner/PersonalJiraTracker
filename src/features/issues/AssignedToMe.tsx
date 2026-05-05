import { useCallback, useEffect, useState } from "react";
import { CheckIcon, IssueKeyLink, PlusIcon, StarIcon } from "../../ui";
import {
  createJiraClientFromSettings,
  formatJiraError,
  searchIssuesAssignedToCurrentUser,
  type JiraIssueSummary,
} from "../../jira";
import { log } from "../../log";
import { upsertDiscoveredIssue } from "./issuesRepo";
import "./AssignedToMe.css";

type Props = {
  weekIssueKeys: ReadonlySet<string>;
  favoriteKeys: ReadonlySet<string>;
  onAddToWeek: (issueKey: string) => void | Promise<void>;
  onToggleFavorite: (issueKey: string) => void | Promise<void>;
  onCacheChanged?: () => void;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; issues: JiraIssueSummary[]; fetchedAt: Date }
  | { kind: "error"; message: string };

export function AssignedToMe({
  weekIssueKeys,
  favoriteKeys,
  onAddToWeek,
  onToggleFavorite,
  onCacheChanged,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [favBusyKey, setFavBusyKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const client = await createJiraClientFromSettings();
      const issues = await searchIssuesAssignedToCurrentUser(client);
      // Cache summaries locally so the palette / recent list can find them
      // by key without another round-trip.
      await Promise.all(
        issues.map((issue) =>
          upsertDiscoveredIssue(issue.issueKey, issue.summary, issue.status),
        ),
      );
      setState({ kind: "ready", issues, fetchedAt: new Date() });
      onCacheChanged?.();
    } catch (cause) {
      log.error("Failed to load assigned issues", cause);
      setState({
        kind: "error",
        message: formatJiraError(cause, { action: "Assigned issues" }),
      });
    }
  }, [onCacheChanged]);

  useEffect(() => {
    void refresh();
    // Only fetch on mount — refresh is manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (issueKey: string) => {
    setBusyKey(issueKey);
    try {
      await onAddToWeek(issueKey);
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleFavorite = async (issueKey: string) => {
    setFavBusyKey(issueKey);
    try {
      await onToggleFavorite(issueKey);
    } finally {
      setFavBusyKey(null);
    }
  };

  return (
    <section className="assigned-to-me" aria-label="Assigned to me">
      <div className="assigned-to-me__head">
        <h2 className="assigned-to-me__title">Assigned to me</h2>
        <button
          type="button"
          className="assigned-to-me__refresh"
          onClick={() => void refresh()}
          disabled={state.kind === "loading"}
          aria-label="Refresh assigned tickets"
          title="Refresh from Jira"
        >
          ↻
        </button>
      </div>

      {state.kind === "loading" && (
        <p className="assigned-to-me__meta">Loading from Jira…</p>
      )}

      {state.kind === "error" && (
        <p className="assigned-to-me__error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "ready" && state.issues.length === 0 && (
        <p className="assigned-to-me__meta">
          No open tickets assigned to you.
        </p>
      )}

      {state.kind === "ready" && state.issues.length > 0 && (
        <ul className="assigned-to-me__list">
          {state.issues.map((issue) => {
            const onWeek = weekIssueKeys.has(issue.issueKey);
            const adding = busyKey === issue.issueKey;
            const isFavorite = favoriteKeys.has(issue.issueKey);
            const favBusy = favBusyKey === issue.issueKey;
            return (
              <li className="assigned-to-me__item" key={issue.issueKey}>
                <button
                  type="button"
                  className={
                    "assigned-to-me__star" +
                    (isFavorite ? " is-favorite" : "")
                  }
                  onClick={() => void handleToggleFavorite(issue.issueKey)}
                  disabled={favBusy}
                  aria-pressed={isFavorite}
                  aria-label={
                    isFavorite
                      ? `Unfavorite ${issue.issueKey}`
                      : `Favorite ${issue.issueKey}`
                  }
                  title={isFavorite ? "Unfavorite" : "Add to favorites"}
                >
                  <StarIcon size={14} filled={isFavorite} />
                </button>
                <div className="assigned-to-me__body">
                  <IssueKeyLink
                    issueKey={issue.issueKey}
                    className="assigned-to-me__key"
                  />
                  <span
                    className="assigned-to-me__summary"
                    title={issue.summary ?? undefined}
                  >
                    {issue.summary ?? "(no summary)"}
                  </span>
                  {issue.status && (
                    <span className="assigned-to-me__status">
                      {issue.status}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="assigned-to-me__add"
                  onClick={() => void handleAdd(issue.issueKey)}
                  disabled={onWeek || adding}
                  aria-label={
                    onWeek
                      ? `${issue.issueKey} already in this week`
                      : `Add ${issue.issueKey} to this week`
                  }
                  title={
                    onWeek ? "Already in this week" : "Add to this week"
                  }
                >
                  {onWeek ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
