import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TimesheetGrid, type TimesheetRow } from "./TimesheetGrid";
import { buildWeek } from "./week";

const today = new Date(2026, 10, 18);
const previousWeek = buildWeek(new Date(2026, 10, 11), today);
const rows: TimesheetRow[] = [
  { issueKey: "ABC-1", summary: "Picked ticket", removable: true },
  { issueKey: "ABC-2", summary: "Ticket with logged time", removable: false },
];

describe("TimesheetGrid carry forward", () => {
  it("offers an action for both picked tickets and tickets with logged time", () => {
    const html = renderToStaticMarkup(
      <TimesheetGrid
        week={previousWeek}
        rows={rows}
        onAddToCurrentWeek={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Add ABC-1 to current week"');
    expect(html).toContain('aria-label="Add ABC-2 to current week"');
    expect(html).not.toMatch(/class="timesheet-grid__row-add"[^>]*disabled/);
  });

  it("marks tickets already in the current week and disables their actions", () => {
    const html = renderToStaticMarkup(
      <TimesheetGrid
        week={previousWeek}
        rows={rows}
        currentWeekIssueKeys={new Set(["ABC-1"])}
        onAddToCurrentWeek={vi.fn()}
      />,
    );

    expect(html).toMatch(
      /class="timesheet-grid__row-add is-added"[^>]*disabled=""[^>]*aria-label="ABC-1 already in current week"/,
    );
    expect(html).toContain('aria-label="Add ABC-2 to current week"');
  });

  it("omits carry forward controls when the page does not supply the action", () => {
    const html = renderToStaticMarkup(
      <TimesheetGrid week={buildWeek(today, today)} rows={rows} />,
    );

    expect(html).not.toContain("timesheet-grid__row-add");
    expect(html).toContain("Picked ticket");
    expect(html).toContain("Ticket with logged time");
  });
});
