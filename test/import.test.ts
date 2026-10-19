import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { parseWhen, planImport } from "@/lib/import-plan";

describe("parseCsv", () => {
  it("handles quotes, commas and newlines in fields, and CRLF", () => {
    expect(parseCsv('when,text\r\n2026-10-20,"Hello, world"\r\nqueue,"Line one\nLine ""two"""\r\n')).toEqual([
      ["when", "text"],
      ["2026-10-20", "Hello, world"],
      ["queue", 'Line one\nLine "two"'],
    ]);
  });
  it("detects semicolon and tab separators and skips blank lines", () => {
    expect(parseCsv("when;text\n\ndraft;Hi")).toEqual([["when", "text"], ["draft", "Hi"]]);
    expect(parseCsv("when\ttext\nqueue\tHi")).toEqual([["when", "text"], ["queue", "Hi"]]);
  });
});

describe("parseWhen", () => {
  it("reads ISO-style and UK dates in the project's timezone", () => {
    expect(parseWhen("2026-10-20 18:00", "Europe/London")?.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(parseWhen("20/10/2026 18:00", "Europe/London")?.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(parseWhen("2026-12-01", "Europe/London")?.toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(parseWhen("next tuesday", "Europe/London")).toBeNull();
  });
});

describe("planImport", () => {
  const accounts = [
    { id: "a1", platform: "bluesky", label: "@5kable.bsky.social" },
    { id: "a2", platform: "x", label: "@5kable" },
  ];
  const opts = { accounts, timeZone: "Europe/London", slots: [{ weekday: 1, minute_of_day: 720 }], taken: [], now: new Date("2026-10-16T12:00:00Z") };

  it("plans timed, queued and draft rows and spreads queued rows across slots", () => {
    const { posts } = planImport(
      parseCsv("when,text,accounts,repeat\n2026-10-20 18:00,Hi,bluesky,weekly\nqueue,First\nqueue,Second\n,Idea"),
      opts,
    );
    expect(posts.map((p) => p.problems)).toEqual([[], [], [], []]);
    expect(posts[0]).toMatchObject({ mode: "time", accountIds: ["a1"], repeat: "weekly" });
    expect(posts[1].at?.toISOString()).toBe("2026-10-19T11:00:00.000Z");
    expect(posts[2].at?.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(posts[3]).toMatchObject({ mode: "draft", at: null });
  });
  it("reports problems per row with line numbers", () => {
    const { posts } = planImport(parseCsv(`when,text,accounts\nsoon,Hi,\n2026-10-01,Old,\n2026-10-20,${"x".repeat(290)},X\n2026-10-20,Hi,mastodon`), opts);
    expect(posts[0].problems[0]).toMatch(/isn't a date/);
    expect(posts[1].problems).toContain("that time has already passed");
    expect(posts[2].problems[0]).toMatch(/@5kable: 10 characters too long/);
    expect(posts[3].problems).toContain('no account called "mastodon"');
    expect(posts.map((p) => p.line)).toEqual([2, 3, 4, 5]);
  });
  it("needs a header row with a text column", () => {
    expect(planImport(parseCsv("2026-10-20,Hi"), opts).error).toMatch(/column headings/);
  });
});

import { csvCell, toCsv } from "@/lib/csv";
describe("csv export", () => {
  it("quotes cells that need it and defuses formulas", () => {
    expect(csvCell('Say "hi", world')).toBe('"Say ""hi"", world"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("@5kable.bsky.social")).toBe("@5kable.bsky.social");
    expect(csvCell("-5 tips")).toBe("-5 tips");
    expect(csvCell(null)).toBe("");
  });
  it("round-trips through the importer's parser", () => {
    const out = toCsv([["text"], ["Line one\nLine, two 🇦🇩"]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(parseCsv(out)).toEqual([["text"], ["Line one\nLine, two 🇦🇩"]]);
  });
});
