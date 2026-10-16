import "server-only";
import { fetchLinkPreview, fetchPreviewImage, firstUrl } from "@/lib/link-preview";
import { PlatformError, readError, type FormAdapter, type MediaFile } from "./shared";

type BlueskyCredentials = { identifier: string; appPassword: string; service: string };

const BSKY_SERVICE = "https://bsky.social";
const APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

async function blueskySession(c: BlueskyCredentials) {
  const res = await fetch(`${c.service}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: c.identifier, password: c.appPassword }),
    cache: "no-store",
  });
  if (!res.ok) throw new PlatformError(`Bluesky sign-in failed: ${await readError(res)}`);
  return (await res.json()) as { accessJwt: string; did: string; handle: string };
}

const encoder = new TextEncoder();

/** Links and hashtags only become clickable on Bluesky when sent as facets with UTF-8 byte offsets. */
export function blueskyFacets(text: string) {
  const facets: object[] = [];
  const byteIndex = (charIndex: number) => encoder.encode(text.slice(0, charIndex)).length;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g)) {
    facets.push({
      index: { byteStart: byteIndex(m.index!), byteEnd: byteIndex(m.index! + m[0].length) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[0] }],
    });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]{1,64})/gu)) {
    const start = m.index! + m[1].length;
    facets.push({
      index: { byteStart: byteIndex(start), byteEnd: byteIndex(start + 1 + m[2].length) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[2] }],
    });
  }
  return facets;
}

async function uploadBlob(service: string, accessJwt: string, bytes: Buffer, mime: string) {
  const res = await fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: { "Content-Type": mime, Authorization: `Bearer ${accessJwt}` },
    body: new Uint8Array(bytes),
    cache: "no-store",
  });
  if (!res.ok) throw new PlatformError(`Bluesky rejected an image: ${await readError(res)}`);
  return ((await res.json()) as { blob: unknown }).blob;
}

/**
 * Bluesky doesn't build link cards itself: without this a link is just text.
 * Uses the first link's Open Graph tags; any failure just means no card.
 */
async function blueskyLinkCard(service: string, accessJwt: string, text: string) {
  const url = firstUrl(text);
  const preview = url ? await fetchLinkPreview(url) : null;
  if (!preview) return undefined;
  const image = preview.image ? await fetchPreviewImage(preview.image, 976 * 1024) : null;
  const thumb = image ? await uploadBlob(service, accessJwt, image.bytes, image.mime).catch(() => undefined) : undefined;
  return {
    $type: "app.bsky.embed.external",
    external: { uri: preview.url, title: preview.title, description: preview.description, ...(thumb ? { thumb } : {}) },
  };
}

/** Uploads each image as a blob and returns the embed that attaches them to the post. */
async function blueskyImages(service: string, accessJwt: string, media: MediaFile[]) {
  const images = [];
  for (const file of media) {
    images.push({ image: await uploadBlob(service, accessJwt, await file.bytes(), file.mime), alt: file.alt ?? "" });
  }
  return { $type: "app.bsky.embed.images", images };
}

export const bluesky: FormAdapter<BlueskyCredentials> = {
  kind: "form",
  async connect(input) {
    const identifier = String(input.get("identifier") ?? "").trim().replace(/^@/, "");
    const appPassword = String(input.get("app_password") ?? "").trim().toLowerCase();
    if (!identifier) throw new PlatformError("Enter the account's handle, e.g. 5kable.bsky.social.");
    if (!APP_PASSWORD.test(appPassword)) {
      throw new PlatformError("That doesn't look like an app password (xxxx-xxxx-xxxx-xxxx). Create one in Bluesky's settings; don't use the main password.");
    }
    const credentials = { identifier, appPassword, service: BSKY_SERVICE };
    const session = await blueskySession(credentials);
    return { credentials, label: `@${session.handle}`, remoteId: session.did };
  },
  async publish(c, text, media) {
    const session = await blueskySession(c);
    const facets = blueskyFacets(text);
    const embed = media.length
      ? await blueskyImages(c.service, session.accessJwt, media)
      : await blueskyLinkCard(c.service, session.accessJwt, text);
    const res = await fetch(`${c.service}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
      body: JSON.stringify({
        repo: session.did,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text,
          createdAt: new Date().toISOString(),
          ...(facets.length ? { facets } : {}),
          ...(embed ? { embed } : {}),
        },
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new PlatformError(`Bluesky rejected the post: ${await readError(res)}`);
    const { uri } = (await res.json()) as { uri: string };
    const rkey = uri.split("/").pop();
    return { url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  },
};
