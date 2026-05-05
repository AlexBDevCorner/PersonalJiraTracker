import { useEffect, useMemo, useState } from "react";
import { IssueKeyLink, StarIcon } from "../../ui";
import type { Week } from "./week";
import {
  getCellSyncMarkersForRange,
  getWorklogTotalsForRange,
  type CellSyncMarkers,
} from "./worklogsRepo";
import "./TimesheetGrid.css";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EXPECTED_HOURS_BY_DAY = [8, 8, 8, 8, 8, 0, 0];

type ExpectedStatus = "ok" | "under" | "over";

function expectedStatus(total: number, expected: number): ExpectedStatus {
  if (expected === 0) return total > 0 ? "over" : "ok";
  if (total < expected) return "under";
  if (total > expected) return "over";
  return "ok";
}

export type TimesheetRow = {
  issueKey: string;
  summary: string | null;
  // True when the row is on the week only because the user picked it (no
  // worklog entries yet) — picks can be removed; rows backed by entries can
  // only be removed by deleting their entries first.
  removable: boolean;
};

type Props = {
  week: Week;
  rows: TimesheetRow[];
  reloadKey?: number;
  favoriteKeys?: ReadonlySet<string>;
  selectedDateIso?: string;
  onCellSelect?: (issueKey: string, isoDate: string) => void;
  onDateSelect?: (isoDate: string) => void;
  onRemoveRow?: (issueKey: string) => void;
  onToggleFavorite?: (issueKey: string) => void | Promise<void>;
};

export function TimesheetGrid({
  week,
  rows,
  reloadKey = 0,
  favoriteKeys,
  selectedDateIso,
  onCellSelect,
  onDateSelect,
  onRemoveRow,
  onToggleFavorite,
}: Props) {
  const [favBusyKey, setFavBusyKey] = useState<string | null>(null);

  const handleToggleFavorite = async (issueKey: string) => {
    if (!onToggleFavorite) return;
    setFavBusyKey(issueKey);
    try {
      await onToggleFavorite(issueKey);
    } finally {
      setFavBusyKey(null);
    }
  };
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [markers, setMarkers] = useState<Map<string, CellSyncMarkers>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const startIso = week.days[0].isoDate;
  const endIso = week.days[6].isoDate;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      getWorklogTotalsForRange(startIso, endIso),
      getCellSyncMarkersForRange(startIso, endIso),
    ])
      .then(([totalRows, markerRows]) => {
        if (cancelled) return;
        const nextTotals = new Map<string, number>();
        for (const row of totalRows) {
          nextTotals.set(cellKey(row.issueKey, row.date), row.totalHours);
        }
        const nextMarkers = new Map<string, CellSyncMarkers>();
        for (const row of markerRows) {
          nextMarkers.set(cellKey(row.issueKey, row.date), row);
        }
        setTotals(nextTotals);
        setMarkers(nextMarkers);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(
          cause instanceof Error ? cause.message : "Failed to load worklog totals.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [startIso, endIso, reloadKey]);

  const issueWeekTotals = useMemo(() => {
    const result = new Map<string, number>();
    for (const row of rows) {
      let sum = 0;
      for (const day of week.days) {
        sum += totals.get(cellKey(row.issueKey, day.isoDate)) ?? 0;
      }
      result.set(row.issueKey, sum);
    }
    return result;
  }, [rows, week.days, totals]);

  const dayTotals = useMemo(() => {
    return week.days.map((day) => {
      let sum = 0;
      for (const row of rows) {
        sum += totals.get(cellKey(row.issueKey, day.isoDate)) ?? 0;
      }
      return sum;
    });
  }, [rows, week.days, totals]);

  const weekTotal = useMemo(
    () => dayTotals.reduce((acc, value) => acc + value, 0),
    [dayTotals],
  );

  if (rows.length === 0) {
    return (
      <p className="timesheet-grid__empty">
        No tickets in this week yet — pick one from your favorites, search, or
        cached issues to start logging time.
      </p>
    );
  }

  return (
    <div className="timesheet-grid" role="table" aria-label="Weekly timesheet">
      {error && (
        <div className="timesheet-grid__error" role="alert">
          {error}
        </div>
      )}
      <div className="timesheet-grid__head" role="row">
        <div className="timesheet-grid__corner" role="columnheader">
          Issue
        </div>
        {week.days.map((day, index) => {
          const isSelected = selectedDateIso === day.isoDate;
          const className =
            "timesheet-grid__day-head" +
            (day.isToday ? " is-today" : "") +
            (isSelected ? " is-selected-col" : "");
          const inner = (
            <>
              <span className="timesheet-grid__day-name">{DAY_NAMES[index]}</span>
              <span className="timesheet-grid__day-date">{day.date.getDate()}</span>
            </>
          );
          return (
            <div
              key={day.isoDate}
              className={className}
              role="columnheader"
              aria-current={day.isToday ? "date" : undefined}
            >
              {onDateSelect ? (
                <button
                  type="button"
                  className="timesheet-grid__day-head-button"
                  onClick={() => onDateSelect(day.isoDate)}
                  aria-pressed={isSelected}
                  aria-label={`Select ${day.isoDate}`}
                >
                  {inner}
                </button>
              ) : (
                inner
              )}
            </div>
          );
        })}
        <div
          className="timesheet-grid__total-head"
          role="columnheader"
          aria-label="Weekly total"
        >
          Total
        </div>
      </div>

      {rows.map((row) => (
        <div className="timesheet-grid__row" role="row" key={row.issueKey}>
          <div className="timesheet-grid__issue" role="rowheader">
            <div className="timesheet-grid__issue-text">
              <IssueKeyLink
                issueKey={row.issueKey}
                className="timesheet-grid__issue-key"
              />
              <span
                className="timesheet-grid__issue-summary"
                title={row.summary ?? undefined}
              >
                {row.summary ?? "(no summary)"}
              </span>
            </div>
            {onToggleFavorite && (() => {
              const isFav = favoriteKeys?.has(row.issueKey) ?? false;
              const busy = favBusyKey === row.issueKey;
              return (
                <button
                  type="button"
                  className={
                    "timesheet-grid__row-star" +
                    (isFav ? " is-favorite" : "")
                  }
                  onClick={() => void handleToggleFavorite(row.issueKey)}
                  disabled={busy}
                  aria-pressed={isFav}
                  aria-label={
                    isFav
                      ? `Unfavorite ${row.issueKey}`
                      : `Favorite ${row.issueKey}`
                  }
                  title={isFav ? "Unfavorite" : "Add to favorites"}
                >
                  <StarIcon size={14} filled={isFav} />
                </button>
              );
            })()}
            {row.removable && onRemoveRow && (
              <button
                type="button"
                className="timesheet-grid__row-remove"
                onClick={() => onRemoveRow(row.issueKey)}
                aria-label={`Remove ${row.issueKey} from this week`}
                title="Remove from this week"
              >
                ×
              </button>
            )}
          </div>
          {week.days.map((day) => {
            const ck = cellKey(row.issueKey, day.isoDate);
            const total = totals.get(ck) ?? 0;
            const marker = markers.get(ck);
            const isEmpty = total === 0 && !marker;
            const pendingLabel = marker ? describeMarker(marker) : null;
            return (
              <button
                type="button"
                key={day.isoDate}
                className={
                  "timesheet-grid__cell" +
                  (day.isToday ? " is-today" : "") +
                  (selectedDateIso === day.isoDate ? " is-selected-col" : "") +
                  (isEmpty ? " is-empty" : "") +
                  (marker ? " is-pending" : "") +
                  (marker?.hasDraft ? " has-draft" : "") +
                  (marker?.hasModified ? " has-modified" : "") +
                  (marker?.hasDeleted ? " has-deleted" : "")
                }
                role="gridcell"
                onClick={() => {
                  onDateSelect?.(day.isoDate);
                  onCellSelect?.(row.issueKey, day.isoDate);
                }}
                aria-label={
                  `${row.issueKey} on ${day.isoDate}: ${formatHours(total)} hours` +
                  (pendingLabel ? `, ${pendingLabel}` : "")
                }
              >
                {isEmpty ? (
                  <span className="timesheet-grid__cell-add" aria-hidden="true">
                    +
                  </span>
                ) : (
                  <span className="timesheet-grid__cell-total">
                    {formatHours(total)}
                  </span>
                )}
                {marker && (
                  <span
                    className="timesheet-grid__cell-pending"
                    aria-hidden="true"
                    title={pendingLabel ?? undefined}
                  />
                )}
              </button>
            );
          })}
          <div
            className="timesheet-grid__row-total"
            role="cell"
            aria-label={`${row.issueKey} weekly total: ${formatHours(issueWeekTotals.get(row.issueKey) ?? 0)} hours`}
          >
            {formatHours(issueWeekTotals.get(row.issueKey) ?? 0)}
          </div>
        </div>
      ))}

      <div
        className="timesheet-grid__row timesheet-grid__totals-row"
        role="row"
      >
        <div className="timesheet-grid__totals-label" role="rowheader">
          Daily total
        </div>
        {week.days.map((day, index) => {
          const expected = EXPECTED_HOURS_BY_DAY[index];
          const status = expectedStatus(dayTotals[index], expected);
          const statusLabel =
            status === "under"
              ? `, below expected ${formatHours(expected)} hours`
              : status === "over"
              ? `, above expected ${formatHours(expected)} hours`
              : "";
          return (
            <div
              key={day.isoDate}
              className={
                "timesheet-grid__day-total" +
                (day.isToday ? " is-today" : "") +
                (selectedDateIso === day.isoDate ? " is-selected-col" : "") +
                (status === "under" ? " is-under" : "") +
                (status === "over" ? " is-over" : "")
              }
              role="cell"
              aria-label={`${DAY_NAMES[index]} total: ${formatHours(dayTotals[index])} hours${statusLabel}`}
              title={
                status === "ok"
                  ? undefined
                  : `Expected ${formatHours(expected)}h`
              }
            >
              {formatHours(dayTotals[index])}
            </div>
          );
        })}
        <div
          className="timesheet-grid__week-total"
          role="cell"
          aria-label={`Weekly total: ${formatHours(weekTotal)} hours`}
        >
          {formatHours(weekTotal)}
        </div>
      </div>
    </div>
  );
}

function cellKey(issueKey: string, isoDate: string): string {
  return `${issueKey}|${isoDate}`;
}

function describeMarker(marker: CellSyncMarkers): string {
  const parts: string[] = [];
  if (marker.hasDraft) parts.push("draft");
  if (marker.hasModified) parts.push("modified");
  if (marker.hasDeleted) parts.push("pending delete");
  if (parts.length === 0) return "";
  return `pending: ${parts.join(", ")}`;
}

function formatHours(hours: number): string {
  if (hours === 0) return "0";
  return Number.parseFloat(hours.toFixed(2)).toString();
}
