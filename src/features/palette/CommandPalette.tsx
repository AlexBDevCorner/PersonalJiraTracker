import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, IssueKeyLink, PlusIcon, StarIcon } from "../../ui";
import {
  formatJiraError,
  isValidIssueKey,
  JiraError,
  lookupJiraIssue,
  normalizeIssueKey,
} from "../../jira";
import { log } from "../../log";
import {
  listCachedIssues,
  upsertIssue,
  type CachedIssue,
} from "../issues/issuesRepo";
import "./CommandPalette.css";

type LookupRow = {
  kind: "lookup";
  issueKey: string;
};

type IssueRow = {
  kind: "issue";
  issue: CachedIssue;
};

type Row = LookupRow | IssueRow;

// Defense-in-depth: cached_issues.url is normally composed from validated Jira
// settings, but openUrl will hand any string to the OS — including file: or
// custom-protocol schemes. A poisoned cache row could otherwise launch
// arbitrary handlers, so reject anything that isn't an https Atlassian URL
// before opening.
function isSafeIssueUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return url.hostname.toLowerCase().endsWith(".atlassian.net");
  } catch {
    return false;
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  weekIssueKeys: ReadonlySet<string>;
  favoriteKeys: ReadonlySet<string>;
  onAddToWeek: (issueKey: string) => Promise<void> | void;
  onToggleFavorite: (issueKey: string) => Promise<void> | void;
  onCacheChanged?: () => void;
};

export function CommandPalette({
  open,
  onClose,
  weekIssueKeys,
  favoriteKeys,
  onAddToWeek,
  onToggleFavorite,
  onCacheChanged,
}: Props) {
  const [query, setQuery] = useState("");
  const [issues, setIssues] = useState<CachedIssue[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const refreshIssues = useCallback(async () => {
    try {
      const rows = await listCachedIssues({ limit: 200 });
      setIssues(rows);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed to load tickets.",
      );
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setError(null);
    void refreshIssues();
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, refreshIssues]);

  const rows: Row[] = useMemo(() => {
    const trimmed = query.trim();
    const lower = trimmed.toLowerCase();
    const filtered =
      trimmed.length === 0
        ? issues
        : issues.filter(
            (issue) =>
              issue.issueKey.toLowerCase().includes(lower) ||
              (issue.summary?.toLowerCase().includes(lower) ?? false),
          );

    const result: Row[] = filtered.map((issue) => ({ kind: "issue", issue }));

    if (trimmed.length > 0 && isValidIssueKey(trimmed)) {
      const key = normalizeIssueKey(trimmed);
      const alreadyShown = filtered.some((issue) => issue.issueKey === key);
      if (!alreadyShown) {
        result.unshift({ kind: "lookup", issueKey: key });
      }
    }

    return result;
  }, [issues, query]);

  useEffect(() => {
    if (selectedIndex >= rows.length) {
      setSelectedIndex(rows.length === 0 ? 0 : rows.length - 1);
    }
  }, [rows.length, selectedIndex]);

  const handleLookup = useCallback(
    async (issueKey: string) => {
      setLooking(true);
      setError(null);
      try {
        const fetched = await lookupJiraIssue(issueKey);
        await upsertIssue(fetched);
        await refreshIssues();
        onCacheChanged?.();
      } catch (cause) {
        if (cause instanceof JiraError && cause.kind === "not_found") {
          setError(`No issue found for ${issueKey}.`);
        } else {
          log.error(`Issue lookup failed for ${issueKey}`, cause);
          setError(formatJiraError(cause, { action: "Issue lookup" }));
        }
      } finally {
        setLooking(false);
      }
    },
    [onCacheChanged, refreshIssues],
  );

  const handleAddToWeek = useCallback(
    async (issueKey: string) => {
      setBusyKey(issueKey);
      try {
        await onAddToWeek(issueKey);
        onClose();
      } finally {
        setBusyKey(null);
      }
    },
    [onAddToWeek, onClose],
  );

  const handleToggleFavorite = useCallback(
    async (issueKey: string) => {
      setBusyKey(issueKey);
      try {
        await onToggleFavorite(issueKey);
      } finally {
        setBusyKey(null);
      }
    },
    [onToggleFavorite],
  );

  const handleOpen = useCallback(async (issue: CachedIssue) => {
    if (!issue.url) return;
    if (!isSafeIssueUrl(issue.url)) {
      log.error(`Refused to open unexpected issue URL scheme/host: ${issue.url}`);
      return;
    }
    try {
      await openUrl(issue.url);
    } catch (cause) {
      log.error("Failed to open issue URL", cause);
    }
  }, []);

  const triggerEnter = useCallback(async () => {
    const row = rows[selectedIndex];
    if (!row) return;
    if (row.kind === "lookup") {
      await handleLookup(row.issueKey);
      return;
    }
    const onWeek = weekIssueKeys.has(row.issue.issueKey);
    if (!onWeek) {
      await handleAddToWeek(row.issue.issueKey);
    }
  }, [rows, selectedIndex, handleLookup, handleAddToWeek, weekIssueKeys]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((idx) => Math.min(idx + 1, Math.max(rows.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((idx) => Math.max(idx - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void triggerEnter();
      return;
    }
  };

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelectorAll<HTMLElement>(
      ".command-palette__row",
    )[selectedIndex];
    item?.scrollIntoView({ block: "nearest" });
  }, [open, selectedIndex]);

  if (!open) return null;

  return (
    <div
      className="command-palette__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Search tickets"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="command-palette">
        <div className="command-palette__input-row">
          <input
            ref={inputRef}
            type="text"
            className="command-palette__input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search tickets or type ABC-123 to look up"
            spellCheck={false}
            autoComplete="off"
          />
          {looking && (
            <span className="command-palette__status">looking up…</span>
          )}
        </div>

        {error && (
          <p className="command-palette__error" role="alert">
            {error}
          </p>
        )}

        {rows.length === 0 ? (
          <p className="command-palette__empty">
            {query.trim().length === 0
              ? "Start typing to search cached tickets."
              : "No matches. Type a full issue key (ABC-123) to fetch from Jira."}
          </p>
        ) : (
          <ul className="command-palette__list" ref={listRef}>
            {rows.map((row, index) => {
              const selected = index === selectedIndex;
              if (row.kind === "lookup") {
                return (
                  <li
                    key={`lookup:${row.issueKey}`}
                    className={
                      "command-palette__row command-palette__row--lookup" +
                      (selected ? " is-selected" : "")
                    }
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => void handleLookup(row.issueKey)}
                  >
                    <span className="command-palette__row-icon">↳</span>
                    <span className="command-palette__row-body">
                      <span className="command-palette__row-key">
                        {row.issueKey}
                      </span>
                      <span className="command-palette__row-summary">
                        Look up from Jira
                      </span>
                    </span>
                    <span className="command-palette__hint">Enter</span>
                  </li>
                );
              }

              const issue = row.issue;
              const onWeek = weekIssueKeys.has(issue.issueKey);
              const isFav = favoriteKeys.has(issue.issueKey);
              const busy = busyKey === issue.issueKey;
              return (
                <li
                  key={issue.issueKey}
                  className={
                    "command-palette__row" + (selected ? " is-selected" : "")
                  }
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => {
                    if (!onWeek) void handleAddToWeek(issue.issueKey);
                    else if (issue.url) void handleOpen(issue);
                  }}
                >
                  <span className="command-palette__row-body">
                    <IssueKeyLink
                      issueKey={issue.issueKey}
                      className="command-palette__row-key"
                    />
                    <span
                      className="command-palette__row-summary"
                      title={issue.summary ?? undefined}
                    >
                      {issue.summary ?? "(no summary)"}
                    </span>
                    {issue.status && (
                      <span className="command-palette__row-meta">
                        {issue.status}
                      </span>
                    )}
                  </span>
                  <div
                    className="command-palette__actions"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className={
                        "command-palette__action" +
                        (isFav ? " is-favorite" : "")
                      }
                      onClick={() => void handleToggleFavorite(issue.issueKey)}
                      disabled={busy}
                      aria-pressed={isFav}
                      aria-label={
                        isFav
                          ? `Remove ${issue.issueKey} from favorites`
                          : `Add ${issue.issueKey} to favorites`
                      }
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      <StarIcon size={14} filled={isFav} />
                    </button>
                    <button
                      type="button"
                      className="command-palette__action"
                      onClick={() => void handleAddToWeek(issue.issueKey)}
                      disabled={onWeek || busy}
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
                    {issue.url && (
                      <button
                        type="button"
                        className="command-palette__action"
                        onClick={() => void handleOpen(issue)}
                        aria-label={`Open ${issue.issueKey} in Jira`}
                        title="Open in Jira"
                      >
                        ↗
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="command-palette__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Enter</kbd> add to week / look up
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
