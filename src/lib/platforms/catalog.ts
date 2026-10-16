// What the app knows about each platform. Safe to import from client components.
// "live" platforms can be connected and posted to today; "planned" ones only appear
// on the setup checklist until their API integration lands.

export type PlatformId =
  | "bluesky"
  | "discord"
  | "x"
  | "instagram"
  | "facebook"
  | "threads"
  | "tiktok"
  | "youtube"
  | "reddit";

export type Platform = {
  id: PlatformId;
  name: string;
  status: "live" | "planned";
  /** How an account is connected: typed into a form, or by signing in on the platform's site. */
  connect: "form" | "oauth";
  /** Longest post the platform accepts, counted in characters (graphemes for Bluesky). */
  maxLength: number;
  signupUrl: string;
  /** Shown on the setup checklist: anything worth knowing before signing up. */
  signupTip: string;
  /** Rough handle limit, so the checklist can warn when the brand handle won't fit. */
  handleMax: number;
  bioMax: number;
  media: MediaRules;
  /** Posts extra thread parts as a reply chain; other platforms get the parts joined into one post. */
  threads?: boolean;
};

export type MediaRules = {
  /** Most attachments in one post; 0 means text only. */
  maxItems: number;
  imageTypes: string[];
  videoTypes: string[];
  maxImageBytes: number;
  maxVideoBytes: number;
  /** Whether images and videos can go in the same post. */
  mixed: boolean;
  /** Platforms like Instagram and TikTok can't post text on its own. */
  requiresMedia?: boolean;
  /** YouTube needs text for the video title. */
  requiresText?: boolean;
};

const MB = 1024 * 1024;
const JPEG_PNG = ["image/jpeg", "image/png"];
const COMMON_IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MP4 = ["video/mp4", "video/quicktime"];
const TEXT_ONLY: MediaRules = { maxItems: 0, imageTypes: [], videoTypes: [], maxImageBytes: 0, maxVideoBytes: 0, mixed: false };

/** Bucket limit: nothing bigger than this can be uploaded at all. */
export const MAX_UPLOAD_BYTES = 50 * MB;
export const UPLOAD_TYPES = [...COMMON_IMAGES, ...MP4];

export const PLATFORMS: Platform[] = [
  {
    id: "bluesky",
    name: "Bluesky",
    status: "live",
    connect: "form",
    maxLength: 300,
    signupUrl: "https://bsky.app/",
    signupTip: "Free to post. After signing up, create an app password in Settings → Privacy and security → App passwords and use that to connect here, never your main password.",
    handleMax: 18,
    bioMax: 256,
    threads: true,
    media: { maxItems: 4, imageTypes: COMMON_IMAGES, videoTypes: [], maxImageBytes: 976 * 1024, maxVideoBytes: 0, mixed: false },
  },
  {
    id: "discord",
    name: "Discord",
    status: "live",
    connect: "form",
    maxLength: 2000,
    signupUrl: "https://discord.com/register",
    signupTip: "Posts go to a channel through a webhook: Server Settings → Integrations → Webhooks → New Webhook, then copy its URL.",
    handleMax: 32,
    bioMax: 190,
    media: { maxItems: 10, imageTypes: COMMON_IMAGES, videoTypes: MP4, maxImageBytes: 10 * MB, maxVideoBytes: 10 * MB, mixed: true },
  },
  {
    id: "x",
    name: "X",
    status: "live",
    connect: "oauth",
    maxLength: 280,
    signupUrl: "https://x.com/i/flow/signup",
    signupTip: "Sign up in a private window with \"Continue with Google\" using the project's own Gmail. Posting through the API is paid per use.",
    handleMax: 15,
    bioMax: 160,
    threads: true,
    media: { maxItems: 4, imageTypes: COMMON_IMAGES, videoTypes: [], maxImageBytes: 5 * MB, maxVideoBytes: 0, mixed: false },
  },
  {
    id: "instagram",
    name: "Instagram",
    status: "live",
    connect: "oauth",
    maxLength: 2200,
    signupUrl: "https://www.instagram.com/accounts/emailsignup/",
    signupTip: "After signing up, switch it to a Professional account (Settings → Account type and tools → Switch to professional account). The API can't post to personal accounts. No Facebook Page needed.",
    handleMax: 30,
    bioMax: 150,
    media: { maxItems: 10, imageTypes: ["image/jpeg"], videoTypes: MP4, maxImageBytes: 8 * MB, maxVideoBytes: MAX_UPLOAD_BYTES, mixed: true, requiresMedia: true },
  },
  {
    id: "facebook",
    name: "Facebook Page",
    status: "live",
    connect: "oauth",
    maxLength: 63206,
    signupUrl: "https://www.facebook.com/pages/create",
    signupTip: "Create a Page from your personal Facebook account rather than a separate profile; Pages are what the API posts to.",
    handleMax: 50,
    bioMax: 255,
    media: { maxItems: 10, imageTypes: COMMON_IMAGES, videoTypes: MP4, maxImageBytes: 10 * MB, maxVideoBytes: MAX_UPLOAD_BYTES, mixed: false },
  },
  {
    id: "threads",
    name: "Threads",
    status: "live",
    connect: "oauth",
    maxLength: 500,
    signupUrl: "https://www.threads.net/",
    signupTip: "Threads signs in with the project's Instagram account, so set that up first.",
    handleMax: 30,
    bioMax: 150,
    threads: true,
    media: { maxItems: 20, imageTypes: JPEG_PNG, videoTypes: MP4, maxImageBytes: 8 * MB, maxVideoBytes: MAX_UPLOAD_BYTES, mixed: true },
  },
  {
    id: "tiktok",
    name: "TikTok",
    status: "live",
    connect: "oauth",
    maxLength: 2200,
    signupUrl: "https://www.tiktok.com/signup",
    signupTip: "Video only. Until TikTok reviews your developer app, posts made through it can only be private, so CtrlAltSocials posts them as private and tells you.",
    handleMax: 24,
    bioMax: 80,
    media: { maxItems: 1, imageTypes: [], videoTypes: MP4, maxImageBytes: 0, maxVideoBytes: MAX_UPLOAD_BYTES, mixed: false, requiresMedia: true },
  },
  {
    id: "youtube",
    name: "YouTube",
    status: "live",
    connect: "oauth",
    maxLength: 5000,
    signupUrl: "https://www.youtube.com/create_channel",
    signupTip: "Create the channel under the project's own Google account. The first line of a post becomes the video title. Uploads stay private until Google audits your API project.",
    handleMax: 30,
    bioMax: 1000,
    media: { maxItems: 1, imageTypes: [], videoTypes: MP4, maxImageBytes: 0, maxVideoBytes: MAX_UPLOAD_BYTES, mixed: false, requiresMedia: true, requiresText: true },
  },
  {
    id: "reddit",
    name: "Reddit",
    status: "live",
    connect: "oauth",
    maxLength: 40300,
    signupUrl: "https://www.reddit.com/register/",
    signupTip: "New accounts can't post in many subreddits until they have some karma and age. Each subreddit has its own self-promotion rules; read them before posting project links.",
    handleMax: 20,
    bioMax: 200,
    media: { ...TEXT_ONLY, requiresText: true },
  },
];

export const LIVE_PLATFORMS = PLATFORMS.filter((p) => p.status === "live");

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const encoder = new TextEncoder();

function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) return [...new Intl.Segmenter().segment(text)].map((s) => s.segment);
  return [...text];
}

/**
 * Length as each platform counts it, close enough to warn before posting:
 * Bluesky counts graphemes; X counts every link as 23 and CJK/emoji as 2;
 * Threads counts emoji by their UTF-8 bytes; the rest count code points.
 */
export function postLength(platform: Platform, text: string): number {
  switch (platform.id) {
    case "bluesky":
      return graphemes(text).length;
    case "x": {
      const links = text.match(URL_RE) ?? [];
      const rest = text.replace(URL_RE, "");
      const weighted = [...rest].reduce((n, ch) => n + (ch.codePointAt(0)! > 0x10ff ? 2 : 1), 0);
      return weighted + links.length * 23;
    }
    case "threads":
      return graphemes(text).reduce((n, g) => n + (EMOJI_RE.test(g) ? encoder.encode(g).length : [...g].length), 0);
    default:
      return [...text].length;
  }
}

export type MediaInfo = { mime: string; size: number };

/** How a thread goes out on a platform: one text per post. Non-thread platforms get one joined post. */
export function threadTexts(platform: Platform, first: string, parts: string[]): string[] {
  const rest = parts.map((p) => p.trim()).filter(Boolean);
  if (rest.length === 0) return [first];
  return platform.threads ? [first, ...rest] : [[first, ...rest].filter(Boolean).join("\n\n")];
}

const fmtMB = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`;

/**
 * Everything wrong with sending this text and media to this platform, in plain English.
 * Shared by the composer, the server action and the publisher so they always agree.
 */
export function postProblems(platform: Platform, text: string, media: MediaInfo[], parts: string[] = []): string[] {
  const problems: string[] = [];
  const r = platform.media;
  const texts = threadTexts(platform, text, parts);
  if (texts.length > 1) {
    texts.forEach((t, i) => {
      const over = postLength(platform, t) - platform.maxLength;
      if (over > 0) problems.push(i === 0 ? `${over} characters too long` : `thread part ${i + 1} is ${over} characters too long`);
      if (i > 0 && !t.trim()) problems.push(`thread part ${i + 1} is empty`);
    });
    text = texts[0];
  } else {
    text = texts[0];
    const length = postLength(platform, text);
    if (length > platform.maxLength) problems.push(`${length - platform.maxLength} characters too long${parts.length ? " (thread parts are joined on this platform)" : ""}`);
  }
  if (!text.trim() && media.length === 0) problems.push("nothing to post");
  if (r.requiresMedia && media.length === 0) problems.push(r.imageTypes.length ? "needs an image or video" : "needs a video");
  if (r.requiresText && !text.trim()) problems.push("needs text (the first line becomes the title)");
  if (platform.id === "reddit" && text.trim() && [...(text.trim().split("\n")[0])].length > 300) problems.push("first line (the title) is over 300 characters");
  if (media.length === 0) return problems;

  if (r.maxItems === 0) return [...problems, "can't take attachments"];
  if (media.length > r.maxItems) problems.push(`max ${r.maxItems} attachment${r.maxItems === 1 ? "" : "s"}`);
  const images = media.filter((m) => m.mime.startsWith("image/"));
  const videos = media.filter((m) => m.mime.startsWith("video/"));
  if (videos.length && !r.videoTypes.length) problems.push("no video support yet");
  if (images.length && !r.imageTypes.length) problems.push("video only");
  if (!r.mixed && images.length && videos.length) problems.push("can't mix images and video");
  if (!r.mixed && videos.length > 1) problems.push("one video per post");
  const badType = media.find((m) => r.imageTypes.length + r.videoTypes.length > 0
    && (m.mime.startsWith("image/") ? r.imageTypes.length && !r.imageTypes.includes(m.mime) : r.videoTypes.length && !r.videoTypes.includes(m.mime)));
  if (badType) problems.push(`doesn't accept ${badType.mime.split("/")[1].toUpperCase()}`);
  const bigImage = images.find((m) => r.maxImageBytes && m.size > r.maxImageBytes);
  if (bigImage) problems.push(`images must be under ${fmtMB(r.maxImageBytes)}`);
  const bigVideo = videos.find((m) => r.maxVideoBytes && m.size > r.maxVideoBytes);
  if (bigVideo) problems.push(`videos must be under ${fmtMB(r.maxVideoBytes)}`);
  return problems;
}
