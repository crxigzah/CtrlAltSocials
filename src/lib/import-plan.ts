import { getPlatform, postProblems } from "@/lib/platforms/catalog";
import { nextFreeSlot, zonedTime, type Repeat, type Slot } from "@/lib/slots";

// Turns spreadsheet rows into posts to create, checking each against the same rules
// as the composer. Pure, so the preview and the import always agree.

export type ImportAccount = { id: string; platform: string; label: string };

export type PlannedPost = {
  line: number;
  text: string;
  /** When it goes out; null means it's saved as a draft. */
  at: Date | null;
  mode: "time" | "queue" | "draft";
  accountIds: string[];
  repeat: Repeat | null;
  problems: string[];
};

export const IMPORT_COLUMNS = ["when", "text", "accounts", "repeat"] as const;

const REPEATS: Record<string, Repeat> = { weekly: "weekly", week: "weekly", fortnightly: "fortnightly", biweekly: "fortnightly", monthly: "monthly", month: "monthly" };

/** "2026-10-20 18:00", "20/10/2026 18:00" (UK order), or ISO with a T. Times are in the project's timezone. */
export function parseWhen(raw: string, timeZone: string): Date | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) return zonedTime(+m[1], +m[2], +m[3], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0, timeZone);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (m) return zonedTime(+m[3], +m[2], +m[1], m[4] ? +m[4] : 9, m[5] ? +m[5] : 0, timeZone);
  return null;
}

/** Matches "bluesky", "X", "@5kable.bsky.social" or a label; blank means every account. */
function resolveAccounts(raw: string, accounts: ImportAccount[]): { ids: string[]; unknown: string[] } {
  const names = raw.split(/[,;|]/).map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (names.length === 0) return { ids: accounts.map((a) => a.id), unknown: [] };
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const name of names) {
    const hits = accounts.filter(
      (a) => a.label.toLowerCase() === name || a.platform === name || getPlatform(a.platform)?.name.toLowerCase() === name,
    );
    if (hits.length) hits.forEach((a) => ids.add(a.id));
    else unknown.push(name);
  }
  return { ids: [...ids], unknown };
}

export function planImport(
  rows: string[][],
  opts: { accounts: ImportAccount[]; timeZone: string; slots: Slot[]; taken: Date[]; now?: Date },
): { posts: PlannedPost[]; error?: string } {
  if (rows.length === 0) return { posts: [], error: "There's nothing to import." };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("text") === -1) return { posts: [], error: 'The first row must be column headings, including a "text" column.' };

  const now = opts.now ?? new Date();
  const taken = [...opts.taken];
  const posts: PlannedPost[] = [];
  rows.slice(1).forEach((row, i) => {
    const get = (name: string) => (col(name) === -1 ? "" : (row[col(name)] ?? "").trim());
    const problems: string[] = [];
    const text = get("text").slice(0, 5000);
    const whenRaw = get("when");

    let mode: PlannedPost["mode"] = "time";
    let at: Date | null = null;
    if (!whenRaw || /^draft$/i.test(whenRaw)) {
      mode = "draft";
    } else if (/^queue$/i.test(whenRaw)) {
      mode = "queue";
      at = nextFreeSlot(opts.slots, opts.timeZone, taken, now);
      if (!at) problems.push("no free posting slot (add slots on the Settings tab)");
    } else {
      at = parseWhen(whenRaw, opts.timeZone);
      if (!at) problems.push(`"${whenRaw}" isn't a date (use 2026-10-20 18:00, 20/10/2026 18:00, queue or draft)`);
      else if (at.getTime() < now.getTime()) problems.push("that time has already passed");
    }
    if (at) taken.push(at);

    const repeatRaw = get("repeat").toLowerCase();
    const repeat = repeatRaw ? REPEATS[repeatRaw] ?? null : null;
    if (repeatRaw && !repeat) problems.push(`"${repeatRaw}" isn't a repeat (weekly, fortnightly or monthly)`);

    const { ids, unknown } = resolveAccounts(get("accounts"), opts.accounts);
    if (unknown.length) problems.push(`no account called ${unknown.map((u) => `"${u}"`).join(", ")}`);
    if (ids.length === 0 && mode !== "draft") problems.push("no accounts to post to");
    if (!text) problems.push("no text");

    // Same platform checks as the composer; drafts are checked later, when scheduled.
    if (mode !== "draft" && text) {
      for (const id of ids) {
        const a = opts.accounts.find((x) => x.id === id)!;
        const platform = getPlatform(a.platform);
        const issues = platform ? postProblems(platform, text, []) : [];
        if (issues.length) problems.push(`${a.label}: ${issues.join(", ")}`);
      }
    }
    posts.push({ line: i + 2, text, at, mode, accountIds: ids, repeat, problems });
  });
  if (posts.length > 200) return { posts: [], error: "That's more than 200 posts; split it into smaller files." };
  return { posts };
}
