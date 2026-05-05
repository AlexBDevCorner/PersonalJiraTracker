import { useMemo } from "react";
import { buildWeek, isSameWeek, shiftWeek } from "./week";
import "./WeekNavigation.css";

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

type Props = {
  reference: Date;
  onChange: (next: Date) => void;
};

function formatRange(start: Date, end: Date): string {
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear !== endYear) {
    return `${startMonth} ${start.getDate()}, ${startYear} – ${endMonth} ${end.getDate()}, ${endYear}`;
  }
  if (startMonth !== endMonth) {
    return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${endYear}`;
  }
  return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${endYear}`;
}

export function WeekNavigation({ reference, onChange }: Props) {
  const today = useMemo(() => new Date(), []);
  const week = useMemo(() => buildWeek(reference, today), [reference, today]);
  const onCurrentWeek = isSameWeek(reference, today);

  return (
    <div className="week-nav">
      <div className="week-nav__bar">
        <button
          type="button"
          className="week-nav__btn"
          onClick={() => onChange(shiftWeek(reference, -1))}
          aria-label="Previous week"
        >
          ← Previous
        </button>
        <span className="week-nav__range" aria-live="polite">
          {formatRange(week.start, week.end)}
        </span>
        <button
          type="button"
          className="week-nav__btn is-primary"
          onClick={() => onChange(today)}
          disabled={onCurrentWeek}
        >
          This week
        </button>
        <button
          type="button"
          className="week-nav__btn"
          onClick={() => onChange(shiftWeek(reference, 1))}
          aria-label="Next week"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
