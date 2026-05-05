import { useEffect, useState } from "react";
import {
  clearLogs,
  formatLogsForExport,
  getLogs,
  subscribeLogs,
  type LogEntry,
} from "../../log";
import "./LogsPanel.css";

export function LogsPanel() {
  const [entries, setEntries] = useState<readonly LogEntry[]>(() => getLogs());
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    return subscribeLogs(() => setEntries(getLogs()));
  }, []);

  const handleCopy = async () => {
    const text = formatLogsForExport(entries);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2000);
  };

  const handleClear = () => {
    clearLogs();
    setCopyState("idle");
  };

  const recent = entries.slice(-50).reverse();

  return (
    <div className="logs-panel">
      <h3 className="logs-panel__title">Diagnostic logs</h3>
      <p className="logs-panel__hint">
        The last {entries.length} log {entries.length === 1 ? "entry" : "entries"}{" "}
        from this session. Useful to share when reporting issues. Logs are kept
        in memory only.
      </p>
      <div className="logs-panel__actions">
        <button
          type="button"
          className="logs-panel__btn"
          onClick={handleCopy}
          disabled={entries.length === 0}
        >
          {copyState === "copied"
            ? "Copied!"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy logs"}
        </button>
        <button
          type="button"
          className="logs-panel__btn"
          onClick={handleClear}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </div>
      {entries.length === 0 ? (
        <div className="logs-panel__empty">No log entries yet.</div>
      ) : (
        <ul className="logs-panel__list">
          {recent.map((entry, index) => (
            <li
              key={`${entry.timestamp}-${index}`}
              className={`logs-panel__entry is-${entry.level}`}
            >
              <span className="logs-panel__timestamp">{entry.timestamp}</span>
              <span className="logs-panel__level">{entry.level}</span>
              <span className="logs-panel__message">{entry.message}</span>
              {entry.details && (
                <pre className="logs-panel__details">{entry.details}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
