import { describe, expect, it } from "vitest";
import { addInZone, nextFreeSlot, nextOccurrence, zonedTime } from "@/lib/slots";

const LONDON = "Europe/London";

describe("zonedTime", () => {
  it("handles BST and GMT", () => {
    expect(zonedTime(2026, 7, 1, 12, 0, LONDON).toISOString()).toBe("2026-07-01T11:00:00.000Z");
    expect(zonedTime(2026, 12, 1, 12, 0, LONDON).toISOString()).toBe("2026-12-01T12:00:00.000Z");
  });
});

describe("nextFreeSlot", () => {
  const slots = [
    { weekday: 1, minute_of_day: 720 }, // Mon 12:00
    { weekday: 3, minute_of_day: 1080 }, // Wed 18:00
  ];
  const friday = new Date("2026-10-16T20:00:00Z");

  it("finds the next slot in local time", () => {
    expect(nextFreeSlot(slots, LONDON, [], friday)?.toISOString()).toBe("2026-10-19T11:00:00.000Z");
  });
  it("skips taken slots and crosses the clocks changing", () => {
    const a = nextFreeSlot(slots, LONDON, [], friday)!;
    const b = nextFreeSlot(slots, LONDON, [a], friday)!;
    expect(b.toISOString()).toBe("2026-10-21T17:00:00.000Z");
    expect(nextFreeSlot(slots, LONDON, [a, b], friday)?.toISOString()).toBe("2026-10-26T12:00:00.000Z");
  });
  it("returns null without slots", () => {
    expect(nextFreeSlot([], LONDON, [], friday)).toBeNull();
  });
});

describe("repeats", () => {
  it("keeps the local time across the clocks changing", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(nextOccurrence(new Date("2026-10-22T11:00:00Z"), "weekly", LONDON, now).toISOString()).toBe("2026-10-29T12:00:00.000Z");
  });
  it("clamps months to the last day", () => {
    expect(addInZone(new Date("2027-01-31T12:00:00Z"), LONDON, { months: 1 }).toISOString()).toBe("2027-02-28T12:00:00.000Z");
  });
  it("jumps a long-missed series to the next future date", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(nextOccurrence(new Date("2026-09-01T11:00:00Z"), "fortnightly", LONDON, now).toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });
});
