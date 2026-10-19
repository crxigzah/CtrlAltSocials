import { describe, expect, it } from "vitest";
import { bestTimes } from "@/lib/best-times";

describe("bestTimes", () => {
  const at = (iso: string, interactions: number) => ({ sentAt: new Date(iso), interactions });
  it("needs enough history", () => {
    expect(bestTimes([at("2026-10-19T11:00:00Z", 10)], "Europe/London")).toEqual([]);
  });
  it("ranks weekday-hour slots by average, in the project's timezone", () => {
    const results = [
      at("2026-10-19T17:05:00Z", 40), // Mon 18:00 BST
      at("2026-10-12T17:30:00Z", 60), // Mon 18:00 BST
      at("2026-10-20T11:00:00Z", 10), // Tue 12:00 BST
      at("2026-10-13T11:00:00Z", 20), // Tue 12:00 BST
      at("2026-10-21T08:00:00Z", 90), // Wed 09:00 BST
      at("2026-10-14T19:00:00Z", 1), //  Wed 20:00 BST
    ];
    expect(bestTimes(results, "Europe/London")).toEqual([
      { weekday: 3, hour: 9, label: "Wed 09:00", average: 90, posts: 1 },
      { weekday: 1, hour: 18, label: "Mon 18:00", average: 50, posts: 2 },
      { weekday: 2, hour: 12, label: "Tue 12:00", average: 15, posts: 2 },
    ]);
  });
});
