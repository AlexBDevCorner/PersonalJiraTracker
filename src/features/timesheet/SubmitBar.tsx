import { useEffect, useState } from "react";
import { getPendingCounts, type PendingCounts } from "./worklogsRepo";
import { submitAllPending, type SubmitAllResult } from "./worklogSync";
import "./SubmitBar.css";

type Props = {
  reloadKey: number;
  onSubmitted: () => void;
};

const EMPTY_COUNTS: PendingCounts = { drafts: 0, modified: 0, deleted: 0, total: 0 };

export function SubmitBar({ reloadKey, onSubmitted }: Props) {
  const [counts, setCounts] = useState<PendingCounts>(EMPTY_COUNTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SubmitAllResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPendingCounts()
      .then((next) => {
        if (cancelled) return;
        setCounts(next);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to count pending changes.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setSummary(null);
    try {
      const result = await submitAllPending();
      setSummary(result);
      onSubmitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submit failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || counts.total === 0;
  const label = submitting
    ? "Submitting…"
    : counts.total === 0
      ? "Nothing to submit"
      : `Submit ${counts.total} change${counts.total === 1 ? "" : "s"}`;

  return (
    <div className="submit-bar">
      <div className="submit-bar__row">
        <button
          type="button"
          className="submit-bar__btn"
          onClick={handleSubmit}
          disabled={disabled}
        >
          {label}
        </button>
        {counts.total > 0 && !submitting && (
          <span className="submit-bar__counts" aria-live="polite">
            {counts.drafts > 0 && <span>{counts.drafts} new</span>}
            {counts.modified > 0 && <span>{counts.modified} modified</span>}
            {counts.deleted > 0 && <span>{counts.deleted} deleted</span>}
          </span>
        )}
      </div>

      {error && (
        <div className="submit-bar__error" role="alert">
          {error}
        </div>
      )}

      {summary && (
        <div
          className={
            "submit-bar__summary" +
            (summary.failures.length > 0 ? " has-failures" : "")
          }
          role="status"
        >
          <div className="submit-bar__summary-line">
            Created {summary.created} · Updated {summary.updated} · Deleted{" "}
            {summary.deleted} · Failed {summary.failures.length}
          </div>
          {summary.failures.length > 0 && (
            <>
              <ul className="submit-bar__failures">
                {summary.failures.map((failure) => (
                  <li key={failure.entry.id}>
                    <strong>
                      {failure.entry.issueKey} · {failure.entry.date} ·{" "}
                      {failure.entry.syncStatus}
                    </strong>{" "}
                    — {failure.message}
                  </li>
                ))}
              </ul>
              <div className="submit-bar__retry-note">
                These entries are still pending — Submit again to retry them.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
