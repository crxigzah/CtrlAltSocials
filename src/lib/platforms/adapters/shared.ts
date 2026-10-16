import "server-only";

export class PlatformError extends Error {}

export type ConnectResult<C> = {
  credentials: C;
  label: string;
  /** The platform's own id for the account, so reconnecting updates it instead of adding a duplicate. */
  remoteId: string;
};

/** `credentials` comes back when the adapter refreshed a token during publishing and it must be saved. */
export type PublishResult<C> = {
  url: string | null;
  /** The platform's id for the new post, used to fetch its numbers later. */
  remoteId?: string;
  credentials?: C;
  /** Something the user should know about a post that did go out (e.g. it was posted as private). */
  note?: string;
};

/** An attachment as the publisher hands it to an adapter. */
export type MediaFile = {
  mime: string;
  size: number;
  alt: string | null;
  /** Short-lived signed URL, for platforms that fetch the file themselves (Threads, Instagram). */
  url: string;
  /** The file's bytes, for platforms the file is uploaded to directly. */
  bytes(): Promise<Buffer>;
  filename: string;
};

/** Engagement as the platform reports it; platforms that don't report a number leave it out. */
export type Metrics = { views?: number; likes?: number; comments?: number; shares?: number };

type Base<C> = {
  publish(credentials: C, text: string, media: MediaFile[]): Promise<PublishResult<C>>;
  /** Current numbers for a post this account made. `credentials` is set when a token was refreshed. */
  metrics?(credentials: C, remoteId: string): Promise<{ metrics: Metrics; credentials?: C }>;
};

/** Platforms connected by typing something into a form (an app password, a webhook URL). */
export type FormAdapter<C> = Base<C> & {
  kind: "form";
  connect(input: FormData): Promise<ConnectResult<C>>;
};

/** Platforms connected by signing in on the platform's own site. */
export type OAuthAdapter<C> = Base<C> & {
  kind: "oauth";
  /** Env vars this platform needs; connecting is disabled until they're set. */
  env: string[];
  authorizeUrl(opts: { state: string; redirectUri: string; codeChallenge: string }): string;
  /** One account, or several for the user to choose from (e.g. every Page a Facebook login manages). */
  exchange(opts: { code: string; redirectUri: string; codeVerifier: string }): Promise<ConnectResult<C> | { choose: ConnectResult<C>[] }>;
};

export type Adapter<C> = FormAdapter<C> | OAuthAdapter<C>;

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    const msg = json.detail || json.error_description || json.error?.message || json.message || json.title || json.error;
    return typeof msg === "string" ? msg : text;
  } catch {
    return text || res.statusText;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new PlatformError(`${name} isn't set on the server.`);
  return value;
}
