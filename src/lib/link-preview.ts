import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Reads a page's Open Graph tags so platforms that don't build link cards
// themselves (Bluesky) can still show one. Best effort: any failure means no card.

export type LinkPreview = { url: string; title: string; description: string; image: string | null };

const MAX_HTML_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;

/** Refuses obviously internal targets; the post text is the owner's, but the server shouldn't be pointed inward. */
export function isPublicHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return null; // IP literals
    return url;
  } catch {
    return null;
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return null;
}

async function readCapped(res: Response, cap: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, cap));
}

/** True for loopback, private, link-local and other non-public addresses. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Resolves the host and refuses it if any address it points at is internal. */
export async function resolvesPublicly(url: URL): Promise<boolean> {
  try {
    const addresses = await lookup(url.hostname, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

export function firstUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/)?.[0] ?? null;
}

export function parsePreview(html: string, url: string, finalUrl: string): LinkPreview | null {
  const title = metaContent(html, ["og:title", "twitter:title"]) ?? decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "");
  if (!title) return null;
  const description = metaContent(html, ["og:description", "twitter:description", "description"]) ?? "";
  const imageRaw = metaContent(html, ["og:image", "og:image:url", "twitter:image"]);
  const image = imageRaw ? new URL(imageRaw, finalUrl).toString() : null;
  return { url, title: title.slice(0, 300), description: description.slice(0, 1000), image: image && isPublicHttpUrl(image) ? image : null };
}

export async function fetchLinkPreview(raw: string): Promise<LinkPreview | null> {
  const url = isPublicHttpUrl(raw);
  if (!url || !(await resolvesPublicly(url))) return null;
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "CtrlAltSocials link preview (+https://github.com/crxigzah/CtrlAltSocials)", Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // Redirects aren't followed: each hop would need the same checks, and cards rarely need them.
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    return parsePreview(await readCapped(res, MAX_HTML_BYTES), url.toString(), res.url || url.toString());
  } catch {
    return null;
  }
}

/** The preview image's bytes, if it's a reasonable image under the size cap. */
export async function fetchPreviewImage(url: string, maxBytes: number): Promise<{ bytes: Buffer; mime: string } | null> {
  const parsed = isPublicHttpUrl(url);
  if (!parsed || !(await resolvesPublicly(parsed))) return null;
  try {
    const res = await fetch(parsed, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!res.ok || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > maxBytes) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length <= maxBytes ? { bytes, mime } : null;
  } catch {
    return null;
  }
}
