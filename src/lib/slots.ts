// Posting slots: "weekdays at 12:00" in the project's own timezone. No date library;
// Intl does the timezone work. Safe to import anywhere (no server-only code).

export type Slot = { weekday: number; minute_of_day: number };

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Wall-clock parts of an instant in a timezone. */
function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")) + 1,
  };
}

/** The UTC instant for a wall-clock time in a timezone (handles BST/GMT and other DST shifts). */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  // Guess as if UTC, then correct by the zone's offset at that moment; a second pass settles DST edges.
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += Date.UTC(year, month - 1, day, hour, minute) - shown;
  }
  return new Date(guess);
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The next slot time after `from` that no other post already occupies, looking up to
 * five weeks ahead. Null when the project has no slots (or every one is taken).
 */
export function nextFreeSlot(slots: Slot[], timeZone: string, taken: Date[], from = new Date()): Date | null {
  if (slots.length === 0) return null;
  const busy = new Set(taken.map((d) => Math.floor(d.getTime() / 60_000)));
  const today = partsIn(from, timeZone);
  const sorted = [...slots].sort((a, b) => a.minute_of_day - b.minute_of_day);
  for (let offset = 0; offset < 35; offset++) {
    // Walk calendar days in the project's timezone (noon avoids DST edge cases when stepping).
    const noon = zonedTime(today.year, today.month, today.day, 12, 0, timeZone);
    const day = partsIn(new Date(noon.getTime() + offset * 86_400_000), timeZone);
    for (const slot of sorted.filter((s) => s.weekday === day.weekday)) {
      const at = zonedTime(day.year, day.month, day.day, Math.floor(slot.minute_of_day / 60), slot.minute_of_day % 60, timeZone);
      if (at.getTime() > from.getTime() + 60_000 && !busy.has(Math.floor(at.getTime() / 60_000))) return at;
    }
  }
  return null;
}

export const formatMinute = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
