import { useEffect, useState } from "react";
import {
  createWorklog,
  deleteWorklog,
  listWorklogsForCell,
  restoreWorklog,
  updateWorklog,
  type WorklogEntry,
  type WorklogInput,
} from "./worklogsRepo";
import { submitDraftWorklogs, submitModifiedWorklogs } from "./worklogSync";
import { WorklogForm } from "./WorklogForm";
import { IssueKeyLink } from "../../ui";
import "./CellPopover.css";

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type Props = {
  issueKey: string;
  issueSummary: string | null;
  isoDate: string;
  onClose: () => void;
  onChanged: () => void;
};

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatHours(hours: number): string {
  if (hours === 0) return "0";
  return Number.parseFloat(hours.toFixed(2)).toString();
}

export function CellPopover({
  issueKey,
  issueSummary,
  isoDate,
  onClose,
  onChanged,
}: Props) {
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<WorklogEntry | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const reload = () => {
    setLoading(true);
    setError(null);
    listWorklogsForCell(issueKey, isoDate)
      .then((rows) => {
        setEntries(rows);
        setLoading(false);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Failed to load entries.");
        setLoading(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listWorklogsForCell(issueKey, isoDate)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Failed to load entries.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issueKey, isoDate]);

  const submitEntry = async (input: WorklogInput) => {
    setError(null);
    setSubmitting(true);
    try {
      if (editingEntry) {
        await updateWorklog(editingEntry.id, input);
      } else {
        await createWorklog(issueKey, isoDate, input);
      }
      setEditingEntry(null);
      reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save entry.");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEntryToJira = async (entry: WorklogEntry) => {
    setError(null);
    setSyncingId(entry.id);
    try {
      const result =
        entry.syncStatus === "modified"
          ? await submitModifiedWorklogs([entry])
          : await submitDraftWorklogs([entry]);
      if (result.failures.length > 0) {
        setError(result.failures[0].message);
      }
      reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to submit entry.");
    } finally {
      setSyncingId(null);
    }
  };

  const removeEntry = async (entry: WorklogEntry) => {
    setError(null);
    try {
      await deleteWorklog(entry.id);
      if (editingEntry?.id === entry.id) {
        setEditingEntry(null);
      }
      reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete entry.");
    }
  };

  const restoreEntry = async (entry: WorklogEntry) => {
    setError(null);
    try {
      await restoreWorklog(entry.id);
      reload();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to restore entry.");
    }
  };

  return (
    <div
      className="cell-popover__backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="cell-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cell-popover-title"
      >
        <header className="cell-popover__header">
          <div>
            <h3 id="cell-popover-title" className="cell-popover__title">
              <IssueKeyLink
                issueKey={issueKey}
                className="cell-popover__issue-key"
              />
              <span
                className="cell-popover__issue-summary"
                title={issueSummary ?? undefined}
              >
                {issueSummary ?? "(no summary)"}
              </span>
            </h3>
            <p className="cell-popover__date">{formatDate(isoDate)}</p>
          </div>
          <button
            type="button"
            className="cell-popover__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="cell-popover__error" role="alert">
            {error}
          </div>
        )}

        <section className="cell-popover__entries" aria-label="Worklog entries">
          {loading ? (
            <p className="cell-popover__empty">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="cell-popover__empty">No entries yet for this day.</p>
          ) : (
            <ul className="cell-popover__list">
              {entries.map((entry) => {
                const isEditing = editingEntry?.id === entry.id;
                const isDeleted = entry.syncStatus === "deleted";
                return (
                  <li
                    key={entry.id}
                    className={
                      "cell-popover__entry" +
                      (isEditing ? " is-editing" : "") +
                      ` is-${entry.syncStatus}`
                    }
                  >
                    <div className="cell-popover__entry-main">
                      <span className="cell-popover__entry-hours">
                        {formatHours(entry.timeSpentHours)}h
                      </span>
                      <span className="cell-popover__entry-comment">
                        {entry.comment}
                      </span>
                    </div>
                    <div className="cell-popover__entry-meta">
                      <span
                        className={`cell-popover__status is-${entry.syncStatus}`}
                      >
                        {isDeleted ? "pending delete" : entry.syncStatus}
                      </span>
                      {isDeleted ? (
                        <button
                          type="button"
                          className="cell-popover__entry-btn is-primary"
                          onClick={() => restoreEntry(entry)}
                        >
                          Restore
                        </button>
                      ) : (
                        <>
                          {(entry.syncStatus === "draft" ||
                            entry.syncStatus === "modified") && (
                            <button
                              type="button"
                              className="cell-popover__entry-btn is-primary"
                              onClick={() => submitEntryToJira(entry)}
                              disabled={syncingId === entry.id}
                            >
                              {syncingId === entry.id
                                ? "Submitting…"
                                : entry.syncStatus === "modified"
                                  ? "Update"
                                  : "Submit"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="cell-popover__entry-btn"
                            onClick={() => setEditingEntry(entry)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="cell-popover__entry-btn is-danger"
                            onClick={() => removeEntry(entry)}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="cell-popover__form-wrap">
          <WorklogForm
            mode={editingEntry ? "edit" : "create"}
            initial={editingEntry ?? undefined}
            submitting={submitting}
            onSubmit={submitEntry}
            onCancel={editingEntry ? () => setEditingEntry(null) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
