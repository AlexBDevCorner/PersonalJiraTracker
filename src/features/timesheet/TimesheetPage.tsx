import { useCallback, useEffect, useMemo, useState } from "react";
import { FavoritesPanel } from "../favorites/FavoritesPanel";
import {
  FavoritePicker,
  isFavoriteIssue,
  listFavoriteIssueKeys,
  unpinIssueFromAllGroups,
} from "../favorites";
import { ensureIssueStub } from "../issues";
import { RecentTickets } from "../issues/RecentTickets";
import { AssignedToMe } from "../issues/AssignedToMe";
import { GitCommitsPanel } from "../gitCommits";
import { CommandPalette } from "../palette/CommandPalette";
import { WeekNavigation } from "./WeekNavigation";
import { TimesheetGrid, type TimesheetRow } from "./TimesheetGrid";
import { CellPopover } from "./CellPopover";
import { SubmitBar } from "./SubmitBar";
import { buildWeek } from "./week";
import { hydrateIssueForWeek, syncWeekFromJira } from "./worklogSync";
import { listIssuesWithWorklogsInRange } from "./worklogsRepo";
import {
  addWeekPick,
  listWeekPicks,
  removeWeekPick,
  type WeekPick,
} from "./weekPicksRepo";
import "./TimesheetPage.css";

type SelectedCell = {
  issueKey: string;
  isoDate: string;
};

type WorklogIssue = {
  issueKey: string;
  summary: string | null;
};

export function TimesheetPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [weekReference, setWeekReference] = useState<Date>(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [worklogIssues, setWorklogIssues] = useState<WorklogIssue[]>([]);
  const [picks, setPicks] = useState<WeekPick[]>([]);
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);

  const today = useMemo(() => new Date(), []);
  const week = useMemo(() => buildWeek(weekReference, today), [weekReference, today]);
  const startIso = week.days[0].isoDate;
  const endIso = week.days[6].isoDate;
  const weekStart = startIso;
  const todayIso = useMemo(() => {
    const t = week.days.find((d) => d.isToday);
    return t ? t.isoDate : null;
  }, [week]);
  const [selectedDateIso, setSelectedDateIso] = useState<string>(
    () => week.days.find((d) => d.isToday)?.isoDate ?? week.days[0].isoDate,
  );

  // Keep selected date inside the visible week when navigating weeks.
  useEffect(() => {
    const inWeek = week.days.some((d) => d.isoDate === selectedDateIso);
    if (inWeek) return;
    setSelectedDateIso(todayIso ?? week.days[0].isoDate);
  }, [week, todayIso, selectedDateIso]);

  // Load picks + worklog-backed issues for the current week.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      listIssuesWithWorklogsInRange(startIso, endIso),
      listWeekPicks(weekStart),
    ])
      .then(([issues, pickRows]) => {
        if (cancelled) return;
        setWorklogIssues(
          issues.map((row) => ({ issueKey: row.issueKey, summary: row.summary })),
        );
        setPicks(pickRows);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Failed to load week contents.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [startIso, endIso, weekStart, reloadKey]);

  // Refresh favorite-key set whenever something changes.
  useEffect(() => {
    let cancelled = false;
    listFavoriteIssueKeys()
      .then((keys) => {
        if (!cancelled) setFavoriteKeys(keys);
      })
      .catch(() => {
        // Non-fatal — favorites just won't show stars.
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Hydrate worklogs from Jira for the visible week.
  useEffect(() => {
    let cancelled = false;
    setFetching(true);
    setFetchError(null);
    const pickKeys = picks.map((p) => p.issueKey);
    syncWeekFromJira(startIso, endIso, pickKeys)
      .then((result) => {
        if (cancelled) return;
        if (result.failures.length > 0) {
          const first = result.failures[0];
          setFetchError(`${first.issueKey}: ${first.message}`);
        } else if (result.discoveryFailed) {
          setFetchError(
            "Could not list issues with logged time for this week. " +
              "Showing only what is cached locally.",
          );
        }
        if (
          result.imported + result.updated + result.removed > 0 ||
          result.discoveredIssues.length > 0
        ) {
          setReloadKey((n) => n + 1);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setFetchError(
          cause instanceof Error ? cause.message : "Failed to fetch Jira worklogs.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIso, endIso]);

  const rows: TimesheetRow[] = useMemo(() => {
    const seen = new Map<string, TimesheetRow>();
    for (const issue of worklogIssues) {
      seen.set(issue.issueKey, {
        issueKey: issue.issueKey,
        summary: issue.summary,
        removable: false,
      });
    }
    for (const pick of picks) {
      const existing = seen.get(pick.issueKey);
      if (existing) continue;
      seen.set(pick.issueKey, {
        issueKey: pick.issueKey,
        summary: pick.summary,
        removable: true,
      });
    }
    return [...seen.values()].sort((a, b) =>
      a.issueKey.localeCompare(b.issueKey),
    );
  }, [worklogIssues, picks]);

  const weekIssueKeys = useMemo(
    () => new Set(rows.map((r) => r.issueKey)),
    [rows],
  );

  const handleAddToWeek = useCallback(
    async (issueKey: string) => {
      await addWeekPick(issueKey, weekStart);
      setReloadKey((n) => n + 1);
      hydrateIssueForWeek(issueKey, startIso, endIso)
        .then((result) => {
          if (result.imported + result.updated + result.removed > 0) {
            setReloadKey((n) => n + 1);
          }
        })
        .catch(() => {
          // Next full sync will retry.
        });
    },
    [weekStart, startIso, endIso],
  );

  const handleRemoveRow = useCallback(
    async (issueKey: string) => {
      await removeWeekPick(issueKey, weekStart);
      setReloadKey((n) => n + 1);
    },
    [weekStart],
  );

  const [pickerKey, setPickerKey] = useState<string | null>(null);

  const handleToggleFavorite = useCallback(async (issueKey: string) => {
    // Ensure the issue exists in the cache before pinning — required by the
    // jira_issues FK on favorite_issues.
    await ensureIssueStub(issueKey);
    const pinned = await isFavoriteIssue(issueKey);
    if (pinned) {
      await unpinIssueFromAllGroups(issueKey);
      setReloadKey((n) => n + 1);
      return;
    }
    setPickerKey(issueKey);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isToggle =
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === "k" || event.key === "K");
      if (isToggle) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectedIssueSummary = useMemo(() => {
    if (!selectedCell) return null;
    const row = rows.find((r) => r.issueKey === selectedCell.issueKey);
    return row?.summary ?? null;
  }, [rows, selectedCell]);

  return (
    <div className="timesheet-page">
      <div className="timesheet-page__left">
        <FavoritesPanel
          reloadKey={reloadKey}
          weekIssueKeys={weekIssueKeys}
          onAdd={handleAddToWeek}
        />
        <AssignedToMe
          weekIssueKeys={weekIssueKeys}
          favoriteKeys={favoriteKeys}
          onAddToWeek={handleAddToWeek}
          onToggleFavorite={handleToggleFavorite}
          onCacheChanged={() => setReloadKey((n) => n + 1)}
        />
        <GitCommitsPanel
          weekStartIso={startIso}
          weekEndIso={endIso}
          selectedDateIso={selectedDateIso}
          reloadKey={reloadKey}
          weekIssueKeys={weekIssueKeys}
          favoriteKeys={favoriteKeys}
          onAddToWeek={handleAddToWeek}
          onToggleFavorite={handleToggleFavorite}
        />
      </div>

      <section className="timesheet-page__center">
        <header className="timesheet-page__head">
          <h2 className="timesheet-page__title">Timesheet</h2>
          <button
            type="button"
            className="timesheet-page__search-trigger"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search tickets"
            title="Search tickets (Ctrl+K)"
          >
            <span className="timesheet-page__search-text">
              Search tickets…
            </span>
            <kbd className="timesheet-page__search-shortcut">Ctrl K</kbd>
          </button>
          <WeekNavigation reference={weekReference} onChange={setWeekReference} />
        </header>

        <SubmitBar
          reloadKey={reloadKey}
          onSubmitted={() => setReloadKey((n) => n + 1)}
        />

        {fetching && (
          <p className="timesheet-fetch-status" aria-live="polite">
            Refreshing worklogs from Jira…
          </p>
        )}
        {fetchError && (
          <p className="timesheet-fetch-error" role="alert">
            Could not refresh from Jira: {fetchError}
          </p>
        )}

        {error ? (
          <span className="timesheet-page__error" role="alert">
            {error}
          </span>
        ) : (
          <TimesheetGrid
            week={week}
            rows={rows}
            reloadKey={reloadKey}
            favoriteKeys={favoriteKeys}
            selectedDateIso={selectedDateIso}
            onCellSelect={(issueKey, isoDate) =>
              setSelectedCell({ issueKey, isoDate })
            }
            onDateSelect={setSelectedDateIso}
            onRemoveRow={handleRemoveRow}
            onToggleFavorite={handleToggleFavorite}
          />
        )}
      </section>

      <RecentTickets
        reloadKey={reloadKey}
        weekIssueKeys={weekIssueKeys}
        favoriteKeys={favoriteKeys}
        onAddToWeek={handleAddToWeek}
        onToggleFavorite={handleToggleFavorite}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        weekIssueKeys={weekIssueKeys}
        favoriteKeys={favoriteKeys}
        onAddToWeek={handleAddToWeek}
        onToggleFavorite={handleToggleFavorite}
        onCacheChanged={() => setReloadKey((n) => n + 1)}
      />

      {selectedCell && (
        <CellPopover
          issueKey={selectedCell.issueKey}
          issueSummary={selectedIssueSummary}
          isoDate={selectedCell.isoDate}
          onClose={() => setSelectedCell(null)}
          onChanged={() => setReloadKey((n) => n + 1)}
        />
      )}

      {pickerKey && (
        <FavoritePicker
          issueKey={pickerKey}
          onClose={() => setPickerKey(null)}
          onPinned={() => {
            setPickerKey(null);
            setReloadKey((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
