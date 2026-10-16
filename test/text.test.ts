import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { firstUrl, parsePreview } from "@/lib/link-preview";
import { blueskyFacets } from "@/lib/platforms/adapters/bluesky";
import { redditParts } from "@/lib/platforms/adapters/reddit";
import { youtubeTitle } from "@/lib/platforms/adapters/youtube";
import { tagLinks } from "@/lib/utm";

describe("tagLinks", () => {
  const opts = { website: "https://5kable.com", platform: "bluesky", campaign: null };
  it("tags links to the project's site, including www and existing queries", () => {
    expect(tagLinks("https://www.5kable.com/x?a=1", opts)).toBe(
      "https://www.5kable.com/x?a=1&utm_source=bluesky&utm_medium=social&utm_campaign=ctrlaltsocials",
    );
  });
  it("leaves other sites and already-tagged links alone, and ignores trailing punctuation", () => {
    expect(tagLinks("https://geoguessr.com", opts)).toBe("https://geoguessr.com");
    expect(tagLinks("https://5kable.com/y?utm_source=mine", opts)).toBe("https://5kable.com/y?utm_source=mine");
    expect(tagLinks("Read https://5kable.com/g.", opts)).toBe("Read https://5kable.com/g?utm_source=bluesky&utm_medium=social&utm_campaign=ctrlaltsocials.");
  });
  it("does nothing without a website", () => {
    expect(tagLinks("https://5kable.com", { ...opts, website: null })).toBe("https://5kable.com");
  });
});

describe("bluesky facets", () => {
  it("uses UTF-8 byte offsets for links and tags", () => {
    const text = "Héllo 🌍 https://5kable.com. #GeoGuessr";
    const bytes = new TextEncoder().encode(text);
    const slice = (f: { index: { byteStart: number; byteEnd: number } }) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
    const facets = blueskyFacets(text) as { index: { byteStart: number; byteEnd: number } }[];
    expect(facets.map(slice)).toEqual(["https://5kable.com", "#GeoGuessr"]);
  });
  it("tags only the link target, not the visible text", () => {
    const [link] = blueskyFacets("https://5kable.com", (u) => `${u}?t=1`) as { features: { uri: string }[] }[];
    expect(link.features[0].uri).toBe("https://5kable.com?t=1");
  });
});

describe("titles", () => {
  it("uses Reddit's first line as the title and spots link posts", () => {
    expect(redditParts("\nNew guide\nhttps://5kable.com/g")).toEqual({ title: "New guide", body: "https://5kable.com/g", link: "https://5kable.com/g" });
    expect(redditParts("Thread\nline one\nline two").link).toBeNull();
  });
  it("makes a valid YouTube title", () => {
    expect(youtubeTitle("  Andorra <Shorts>\nmore")).toBe("Andorra Shorts");
    expect([...youtubeTitle("x".repeat(150))].length).toBe(100);
  });
});

describe("link previews", () => {
  it("reads Open Graph tags in any attribute order and resolves relative images", () => {
    const html = `<meta property="og:title" content="Andorra &amp; clues"><meta content="Plates &#39;AND&#39;" property="og:description"><meta property="og:image" content="/img.jpg">`;
    expect(parsePreview(html, "https://5kable.com/a", "https://5kable.com/a")).toEqual({
      url: "https://5kable.com/a",
      title: "Andorra & clues",
      description: "Plates 'AND'",
      image: "https://5kable.com/img.jpg",
    });
  });
  it("finds the first link", () => {
    expect(firstUrl("see https://5kable.com/x. ok")).toBe("https://5kable.com/x");
  });
});

describe("credential encryption", () => {
  process.env.CREDENTIALS_KEY = Buffer.alloc(32, 7).toString("base64");
  it("round-trips and rejects tampering", () => {
    const sealed = encryptJson({ token: "secret" });
    expect(sealed).not.toContain("secret");
    expect(decryptJson(sealed)).toEqual({ token: "secret" });
    expect(() => decryptJson(sealed.slice(0, -4) + "AAAA")).toThrow();
  });
});

import { linkedInCommentary } from "@/lib/platforms/adapters/linkedin";
describe("linkedInCommentary", () => {
  it("escapes LinkedIn's reserved characters but keeps hashtags as hashtags", () => {
    expect(linkedInCommentary("New guide (Andorra) for @fans! #GeoGuessr #5k_tips")).toBe(
      "New guide \\(Andorra\\) for \\@fans! {hashtag|\\#|GeoGuessr} {hashtag|\\#|5k_tips}",
    );
  });
  it("leaves plain text and links alone", () => {
    expect(linkedInCommentary("See https://5kable.com/guides")).toBe("See https://5kable.com/guides");
  });
});
describe("linkedInCommentary links", () => {
  it("doesn't escape characters inside links", () => {
    expect(linkedInCommentary("Map: https://5kable.com/maps/driving_side_(2026) (new)")).toBe("Map: https://5kable.com/maps/driving_side_(2026) \\(new\\)");
  });
});
