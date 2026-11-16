import { useCallback, useEffect, useRef, useState } from "react";
import { createJiraClientFromSettings, formatJiraError } from "../../jira";
import { ErrorBanner, IssueKeyLink } from "../../ui";
import { log } from "../../log";
import { fetchBoard, moveBoardIssue, type BoardData, type BoardIssue } from "./boardApi";
import "./BoardPage.css";

const REFRESH_INTERVAL_MS = 60_000;
const DRAG_TYPE = "application/x-jira-board-issue";

export function BoardPage() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const busy = useRef(false);
  const dragging = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (busy.current || dragging.current) return;
    busy.current = true;
    const current = generation.current;
    setRefreshing(true);
    try {
      const client = await createJiraClientFromSettings();
      const data = await fetchBoard(client);
      if (generation.current !== current) return;
      setBoard(data);
      setFetchedAt(new Date());
      setError(null);
    } catch (cause) {
      log.error("Failed to refresh personal board", cause);
      if (generation.current === current) setError(formatJiraError(cause, { action: "Board refresh" }));
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      generation.current += 1;
      busy.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  const move = async (issue: BoardIssue, statusId: string) => {
    if (busy.current || issue.status.id === statusId) return;
    busy.current = true;
    const current = generation.current;
    setMovingKey(issue.issueKey);
    setError(null);
    try {
      const client = await createJiraClientFromSettings();
      const status = await moveBoardIssue(client, issue.issueKey, statusId);
      if (generation.current !== current) return;
      // Keep the confirmed move visible while Jira's search index catches up.
      setBoard((previous) => previous && ({
        ...previous,
        issues: previous.issues.map((item) => item.issueKey === issue.issueKey ? { ...item, status } : item),
      }));
      setAnnouncement(`${issue.issueKey} moved to ${status.name}. Saved to Jira.`);
    } catch (cause) {
      log.error(`Failed to move ${issue.issueKey}`, cause);
      if (generation.current === current) {
        setError(`${formatJiraError(cause, { action: "Move ticket" })} Refresh to confirm its current status before retrying.`);
      }
    } finally {
      if (generation.current === current) {
        busy.current = false;
        setMovingKey(null);
      }
    }
  };

  return (
    <section className="board-page" aria-labelledby="board-title">
      <div className="board-page__head">
        <div>
          <p className="eyebrow">Assigned to me</p>
          <h1 id="board-title">My board</h1>
          <p className="board-page__hint">Drag a ticket to change its status in Jira, or use its Move to menu.</p>
        </div>
        <div className="board-page__sync">
          <span>{refreshing ? "Syncing with Jira…" : fetchedAt
            ? `Last synced ${fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · Every minute`
            : "Automatic sync every minute"}</span>
          <button type="button" className="board-page__refresh" disabled={refreshing || movingKey !== null || draggedKey !== null}
            onClick={() => void refresh()}>↻ Refresh</button>
        </div>
      </div>
      <p className="board-page__sr-only" role="status">{announcement}</p>
      {error && <ErrorBanner title="Board could not sync" message={error} onRetry={() => void refresh()} onDismiss={() => setError(null)} />}
      {!board && !error && <p className="board-page__empty" role="status">Loading your tickets from Jira…</p>}
      {board?.issues.length === 0 && <p className="board-page__empty">No tickets assigned to you in Jira.</p>}
      {board && board.issues.length > 0 && (
        <div className="board-page__columns" aria-label="Ticket statuses" aria-busy={movingKey !== null}>
          {board.statuses.map((status) => {
            const issues = board.issues.filter((issue) => issue.status.id === status.id);
            return (
              <section key={status.id} className={`board-column${dropTarget === status.id ? " is-drop-target" : ""}`}
                aria-label={`${status.name} (${issues.length})`} data-category={status.statusCategory?.key}
                onDragOver={(event) => {
                  if (!draggedKey || busy.current) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(status.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const key = event.dataTransfer.getData(DRAG_TYPE);
                  const issue = board.issues.find((item) => item.issueKey === key);
                  dragging.current = false;
                  setDraggedKey(null);
                  setDropTarget(null);
                  if (issue && key === draggedKey) void move(issue, status.id);
                }}>
                <header className="board-column__head">
                  <span className="board-column__dot" aria-hidden="true" />
                  <h2 title={status.name}>{status.name}</h2>
                  <span className="board-column__count">{issues.length}</span>
                </header>
                <ul className="board-column__tickets">
                  {issues.map((issue) => (
                    <li key={issue.issueKey} className={`board-ticket${draggedKey === issue.issueKey ? " is-dragging" : ""}`}
                      draggable={!refreshing && movingKey === null}
                      onDragStart={(event) => {
                        if (busy.current) { event.preventDefault(); return; }
                        event.dataTransfer.setData(DRAG_TYPE, issue.issueKey);
                        event.dataTransfer.effectAllowed = "move";
                        dragging.current = true;
                        setDraggedKey(issue.issueKey);
                      }}
                      onDragEnd={() => {
                        dragging.current = false;
                        setDraggedKey(null);
                        setDropTarget(null);
                      }}>
                      <div className="board-ticket__top">
                        <IssueKeyLink issueKey={issue.issueKey} />
                        <span className="board-ticket__grip" aria-hidden="true">⠿</span>
                      </div>
                      <p className="board-ticket__summary">{issue.summary}</p>
                      <select aria-label={`Move ${issue.issueKey} to status`} value=""
                        disabled={refreshing || movingKey !== null}
                        onChange={(event) => void move(issue, event.target.value)}>
                        <option value="" disabled>{movingKey === issue.issueKey ? "Saving to Jira…" : "Move to…"}</option>
                        {board.statuses.filter((target) => target.id !== issue.status.id).map((target) => (
                          <option key={target.id} value={target.id}>{target.name}</option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
                {issues.length === 0 && <p className="board-column__empty">No tickets</p>}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
