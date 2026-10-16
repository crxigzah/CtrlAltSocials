import { describe, expect, it } from "vitest";
import { getPlatform, postLength, postProblems, threadTexts } from "@/lib/platforms/catalog";

const p = (id: string) => getPlatform(id)!;
const MB = 1024 * 1024;

describe("postLength", () => {
  it("counts every link as 23 on X", () => {
    expect(postLength(p("x"), "See https://5kable.com/guides/a-very-long-path-indeed")).toBe(4 + 23);
  });
  it("counts graphemes on Bluesky, so a flag is one character", () => {
    expect(postLength(p("bluesky"), "🇦🇩")).toBe(1);
  });
  it("counts emoji by UTF-8 bytes on Threads", () => {
    expect(postLength(p("threads"), "hi 😀")).toBe(3 + 4);
  });
});

describe("postProblems", () => {
  it("passes a normal post", () => {
    expect(postProblems(p("bluesky"), "Hello", [])).toEqual([]);
  });
  it("catches too-long text", () => {
    expect(postProblems(p("x"), "x".repeat(290), [])).toContain("10 characters too long");
  });
  it("only flags an empty post once something's needed", () => {
    expect(postProblems(p("discord"), "", [])).toContain("nothing to post");
  });
  it("enforces attachment rules per platform", () => {
    expect(postProblems(p("bluesky"), "hi", [{ mime: "video/mp4", size: MB }])).toContain("no video support yet");
    expect(postProblems(p("threads"), "hi", [{ mime: "image/webp", size: MB }])).toContain("doesn't accept WEBP");
    expect(postProblems(p("reddit"), "hi", [{ mime: "image/jpeg", size: MB }])).toContain("can't take attachments");
    expect(postProblems(p("bluesky"), "hi", Array(5).fill({ mime: "image/jpeg", size: 1000 }))).toContain("max 4 attachments");
  });
  it("requires media where the platform does", () => {
    expect(postProblems(p("instagram"), "caption", [])).toContain("needs an image or video");
    expect(postProblems(p("tiktok"), "caption", [])).toContain("needs a video");
  });
  it("requires a title line on YouTube and caps Reddit titles", () => {
    expect(postProblems(p("youtube"), "", [{ mime: "video/mp4", size: MB }])).toContain("needs text (the first line becomes the title)");
    expect(postProblems(p("reddit"), "t".repeat(301), [])).toContain("first line (the title) is over 300 characters");
  });
});

describe("threads", () => {
  it("keeps parts separate on thread platforms and drops blank ones", () => {
    expect(threadTexts(p("x"), "one", ["two", "  ", "three"])).toEqual(["one", "two", "three"]);
  });
  it("joins parts on platforms without threads", () => {
    expect(threadTexts(p("discord"), "one", ["two"])).toEqual(["one\n\ntwo"]);
  });
  it("checks each thread part against the limit", () => {
    expect(postProblems(p("x"), "ok", [], ["y".repeat(300)])).toEqual(["thread part 2 is 20 characters too long"]);
  });
  it("checks joined parts as one post", () => {
    expect(postProblems(p("bluesky"), "a".repeat(200), [], ["b".repeat(200)])).toEqual([]);
    expect(postProblems(p("discord"), "a".repeat(1500), [], ["b".repeat(600)])[0]).toMatch(/joined/);
  });
});

describe("mastodon and linkedin", () => {
  it("counts Mastodon links as 23 characters", () => {
    expect(postLength(p("mastodon"), "Read https://5kable.com/guides/a-long-path")).toBe(5 + 23);
  });
  it("threads on Mastodon but joins on LinkedIn", () => {
    expect(threadTexts(p("mastodon"), "a", ["b"])).toEqual(["a", "b"]);
    expect(threadTexts(p("linkedin"), "a", ["b"])).toEqual(["a\n\nb"]);
  });
});
