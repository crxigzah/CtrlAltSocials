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
  /** Longest post the platform accepts, counted in characters (graphemes for Bluesky). */
  maxLength: number;
  signupUrl: string;
  /** Shown on the setup checklist: anything worth knowing before signing up. */
  signupTip: string;
  /** Rough handle limit, so the checklist can warn when the brand handle won't fit. */
  handleMax: number;
  bioMax: number;
};

export const PLATFORMS: Platform[] = [
  {
    id: "bluesky",
    name: "Bluesky",
    status: "live",
    maxLength: 300,
    signupUrl: "https://bsky.app/",
    signupTip: "Free to post. After signing up, create an app password in Settings → Privacy and security → App passwords and use that to connect here, never your main password.",
    handleMax: 18,
    bioMax: 256,
  },
  {
    id: "discord",
    name: "Discord",
    status: "live",
    maxLength: 2000,
    signupUrl: "https://discord.com/register",
    signupTip: "Posts go to a channel through a webhook: Server Settings → Integrations → Webhooks → New Webhook, then copy its URL.",
    handleMax: 32,
    bioMax: 190,
  },
  {
    id: "x",
    name: "X",
    status: "planned",
    maxLength: 280,
    signupUrl: "https://x.com/i/flow/signup",
    signupTip: "Sign up in a private window with \"Continue with Google\" using the project's own Gmail. Posting through the API is paid per use.",
    handleMax: 15,
    bioMax: 160,
  },
  {
    id: "instagram",
    name: "Instagram",
    status: "planned",
    maxLength: 2200,
    signupUrl: "https://www.instagram.com/accounts/emailsignup/",
    signupTip: "Switch it to a Professional (Business or Creator) account and link it to the project's Facebook Page, or the API can't post to it.",
    handleMax: 30,
    bioMax: 150,
  },
  {
    id: "facebook",
    name: "Facebook Page",
    status: "planned",
    maxLength: 63206,
    signupUrl: "https://www.facebook.com/pages/create",
    signupTip: "Create a Page from your personal Facebook account rather than a separate profile; Pages are what the API posts to.",
    handleMax: 50,
    bioMax: 255,
  },
  {
    id: "threads",
    name: "Threads",
    status: "planned",
    maxLength: 500,
    signupUrl: "https://www.threads.net/",
    signupTip: "Threads signs in with the project's Instagram account, so set that up first.",
    handleMax: 30,
    bioMax: 150,
  },
  {
    id: "tiktok",
    name: "TikTok",
    status: "planned",
    maxLength: 2200,
    signupUrl: "https://www.tiktok.com/signup",
    signupTip: "Video only. Posts made through the API stay private until TikTok approves the app in its audit.",
    handleMax: 24,
    bioMax: 80,
  },
  {
    id: "youtube",
    name: "YouTube",
    status: "planned",
    maxLength: 5000,
    signupUrl: "https://www.youtube.com/create_channel",
    signupTip: "Create a Brand Account channel under the project's Google account so it can have its own name and managers.",
    handleMax: 30,
    bioMax: 1000,
  },
  {
    id: "reddit",
    name: "Reddit",
    status: "planned",
    maxLength: 40000,
    signupUrl: "https://www.reddit.com/register/",
    signupTip: "Each subreddit has its own self-promotion rules; read them before posting project links.",
    handleMax: 20,
    bioMax: 200,
  },
];

export const LIVE_PLATFORMS = PLATFORMS.filter((p) => p.status === "live");

export function getPlatform(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

/** Length as the platform counts it: Bluesky counts graphemes, the rest close enough to code points. */
export function postLength(platform: Platform, text: string): number {
  if (platform.id === "bluesky" && typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter().segment(text)].length;
  }
  return [...text].length;
}
