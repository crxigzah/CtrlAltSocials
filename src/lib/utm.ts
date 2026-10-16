// Adds UTM tags to links pointing at the project's own website, so its analytics
// can tell which platform each visitor came from. Links elsewhere are left alone,
// as are links that already carry their own utm_source.

const URL_RE = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

function siteHost(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function tagLinks(text: string, opts: { website: string | null; platform: string; campaign?: string | null }): string {
  const host = siteHost(opts.website);
  if (!host) return text;
  return text.replace(URL_RE, (raw) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return raw;
    }
    const linkHost = url.hostname.replace(/^www\./, "").toLowerCase();
    if (linkHost !== host && !linkHost.endsWith(`.${host}`)) return raw;
    if (url.searchParams.has("utm_source")) return raw;
    url.searchParams.set("utm_source", opts.platform);
    url.searchParams.set("utm_medium", "social");
    url.searchParams.set("utm_campaign", opts.campaign?.trim() || "ctrlaltsocials");
    return url.toString();
  });
}
