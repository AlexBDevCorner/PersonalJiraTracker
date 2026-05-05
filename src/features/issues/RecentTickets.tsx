import { useEffect, useState } from "react";
import { CheckIcon, IssueKeyLink, PlusIcon, StarIcon } from "../../ui";
import { listCachedIssues, type CachedIssue } from "./issuesRepo";
import "./RecentTickets.css";

type Props = {
  reloadKey: number;
  weekIssueKeys: ReadonlySet<string>;
  favoriteKeys: ReadonlySet<string>;
  onAddToWeek: (issueKey: string) => void | Promise<void>;
  onToggleFavorite: (issueKey: string) => void | Promise<void>;
};

export function RecentTickets({
  reloadKey,
  weekIssueKeys,
  favoriteKeys,
  onAddToWeek,
  onToggleFavorite,
}: Props) {
  const [issues, setIssues] = useState<CachedIssue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [favBusyKey, setFavBusyKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCachedIssues()
      .then((rows) => {
        if (cancelled) return;
        setIssues(rows);
        setError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Failed to load recent tickets.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

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
    <aside className="recent-tickets" aria-label="Recent tickets">
      <div className="recent-tickets__head">
        <h2 className="recent-tickets__title">Recent tickets</h2>
      </div>

      {error && (
        <p className="recent-tickets__error" role="alert">
          {error}
        </p>
      )}

      {issues === null ? (
        <p className="recent-tickets__meta">Loading…</p>
      ) : issues.length === 0 ? (
        <p className="recent-tickets__meta">
          No tickets yet. Press <kbd>Ctrl</kbd>+<kbd>K</kbd> to search and add
          one.
        </p>
      ) : (
        <ul className="recent-tickets__list">
          {issues.map((issue) => {
            const onWeek = weekIssueKeys.has(issue.issueKey);
            const adding = busyKey === issue.issueKey;
            const isFavorite = favoriteKeys.has(issue.issueKey);
            const favBusy = favBusyKey === issue.issueKey;
            return (
              <li className="recent-tickets__item" key={issue.issueKey}>
                <button
                  type="button"
                  className={
                    "recent-tickets__star" +
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
                <div className="recent-tickets__body">
                  <IssueKeyLink
                    issueKey={issue.issueKey}
                    className="recent-tickets__key"
                  />
                  <span
                    className="recent-tickets__summary"
                    title={issue.summary ?? undefined}
                  >
                    {issue.summary ?? "(no summary)"}
                  </span>
                  {issue.status && (
                    <span className="recent-tickets__meta-line">{issue.status}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="recent-tickets__add"
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
    </aside>
  );
}
