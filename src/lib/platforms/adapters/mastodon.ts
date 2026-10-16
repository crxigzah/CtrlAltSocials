import "server-only";
import { isPublicHttpUrl, resolvesPublicly } from "@/lib/link-preview";
import { partialThreadNote, PlatformError, readError, type FormAdapter, type MediaFile } from "./shared";

// Mastodon (and compatible servers). Connected with the server's address and an
// access token from Preferences -> Development -> New application, so there's no
// developer app to register here.

type MastodonCredentials = { instance: string; accessToken: string; accountId: string; acct: string };

async function instanceUrl(raw: string): Promise<string> {
  const withScheme = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  const url = isPublicHttpUrl(withScheme);
  // The address is typed by the user and fetched by the server, so it must be a public host.
  if (!url || url.protocol !== "https:" || !(await resolvesPublicly(url))) {
    throw new PlatformError("Enter your Mastodon server's address, e.g. mastodon.social.");
  }
  return url.origin;
}

function api(c: { instance: string; accessToken: string }, path: string, init: RequestInit = {}) {
  return fetch(`${c.instance}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.accessToken}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

/** Images are ready at once; video is processed in the background, so wait for it. */
async function uploadMedia(c: MastodonCredentials, file: MediaFile): Promise<string> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(await file.bytes())], { type: file.mime }), file.filename);
  if (file.alt) form.set("description", file.alt.slice(0, 1500));
  const res = await api(c, "/api/v2/media", { method: "POST", body: form });
  if (!res.ok) throw new PlatformError(`Mastodon rejected an attachment: ${await readError(res)}`);
  const media = (await res.json()) as { id: string; url: string | null };
  for (let i = 0; !media.url && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const check = await api(c, `/api/v1/media/${media.id}`);
    if (check.ok) media.url = ((await check.json()) as { url: string | null }).url;
  }
  if (!media.url) throw new PlatformError("Mastodon is still processing the video. Try again in a minute.");
  return media.id;
}

export const mastodon: FormAdapter<MastodonCredentials> = {
  kind: "form",
  async connect(input) {
    const instance = await instanceUrl(String(input.get("instance") ?? ""));
    const accessToken = String(input.get("access_token") ?? "").trim();
    if (accessToken.length < 20) throw new PlatformError("Paste the access token from your Mastodon application's page.");
    const res = await api({ instance, accessToken }, "/api/v1/accounts/verify_credentials");
    if (!res.ok) throw new PlatformError(`Mastodon didn't accept that token: ${await readError(res)}`);
    const me = (await res.json()) as { id: string; acct: string };
    const acct = `@${me.acct}@${new URL(instance).hostname}`;
    return { credentials: { instance, accessToken, accountId: me.id, acct }, label: acct, remoteId: `${instance}/${me.id}` };
  },

  async publish(c, text, media, thread = []) {
    const mediaIds = [];
    for (const file of media) mediaIds.push(await uploadMedia(c, file));
    const post = async (status: string, extra: Record<string, unknown>) => {
      const res = await api(c, "/api/v1/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ status, visibility: "public", ...extra }),
      });
      if (!res.ok) throw new PlatformError(`Mastodon rejected the post: ${await readError(res)}`);
      return (await res.json()) as { id: string; url: string };
    };

    const first = await post(text, mediaIds.length ? { media_ids: mediaIds } : {});
    let previous = first.id;
    for (const [i, part] of thread.entries()) {
      try {
        previous = (await post(part, { in_reply_to_id: previous })).id;
      } catch (err) {
        return { url: first.url, remoteId: first.id, note: partialThreadNote(i + 1, thread.length + 1, err) };
      }
    }
    return { url: first.url, remoteId: first.id };
  },

  async metrics(c, id) {
    const res = await api(c, `/api/v1/statuses/${encodeURIComponent(id)}`);
    if (!res.ok) throw new PlatformError(`Mastodon stats lookup failed: ${await readError(res)}`);
    const s = (await res.json()) as { favourites_count: number; reblogs_count: number; replies_count: number };
    return { metrics: { likes: s.favourites_count, shares: s.reblogs_count, comments: s.replies_count } };
  },
};
