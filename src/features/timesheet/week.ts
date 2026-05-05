export type WeekDay = {
  date: Date;
  isoDate: string;
  isToday: boolean;
};

export type Week = {
  start: Date;
  end: Date;
  days: WeekDay[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  const dayOfWeek = day.getDay();
  // Monday-first: Sunday(0) is 6 days after Monday, others are dayOfWeek - 1.
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDays(day, -offset);
}

export function buildWeek(reference: Date, today: Date = new Date()): Week {
  const start = startOfWeek(reference);
  const todayIso = toIsoDate(startOfDay(today));
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i);
    const isoDate = toIsoDate(date);
    days.push({ date, isoDate, isToday: isoDate === todayIso });
  }
  return { start, end: days[6].date, days };
}

export function shiftWeek(reference: Date, weeks: number): Date {
  return addDays(startOfWeek(reference), weeks * 7);
}

export function isSameWeek(a: Date, b: Date): boolean {
  return Math.abs(startOfWeek(a).getTime() - startOfWeek(b).getTime()) < MS_PER_DAY / 2;
}
