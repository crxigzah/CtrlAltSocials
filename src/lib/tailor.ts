import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getPlatform, postLength, type Platform } from "@/lib/platforms/catalog";
import type { Workspace } from "@/lib/types";

// "Tailor with AI": rewrites one post for each selected account, inside that
// platform's limits and conventions. The results land in the per-account boxes
// for the user to check; nothing is posted without them seeing it.

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

type Target = { id: string; label: string; platform: Platform };

/** Platform conventions the model should follow, beyond the raw character limit. */
const STYLE: Partial<Record<Platform["id"], string>> = {
  x: "Punchy, one or two short sentences. Every link counts as 23 characters. At most two hashtags.",
  bluesky: "Conversational and plain; hashtags are rare on Bluesky, use one at most. Counted in characters.",
  threads: "Casual and friendly, can be a couple of short paragraphs. One or two hashtags at most.",
  instagram: "Caption for an image or video post. Links aren't clickable in captions, so say 'link in bio' instead of pasting a URL. A short block of relevant hashtags at the end is normal.",
  facebook: "Friendly and a little fuller; links are fine and get a preview card.",
  discord: "Written for the project's own community channel; can be more detailed and use simple markdown.",
  youtube: "The FIRST LINE is the video title (keep it under 100 characters, no < or >); the rest is the description.",
  tiktok: "Short caption for a video with a few relevant hashtags.",
  reddit: "The FIRST LINE is the post title (under 300 characters, no clickbait or hashtags). The rest is the body, written like a genuine community post rather than an advert. If the post is mainly a link, the body can be just the URL.",
};

function systemPrompt(ws: Workspace) {
  const brand = [
    `Project: ${ws.name}`,
    ws.handle && `Handle: @${ws.handle}`,
    ws.bio && `About: ${ws.bio}`,
    ws.website && `Website: ${ws.website}`,
  ]
    .filter(Boolean)
    .join("\n");
  return `You adapt a social media post for each of a project's accounts, so it fits each platform's limits and conventions.

${brand}

Rules:
- Keep every fact, date, name and link from the original. Don't invent details, offers, statistics or links.
- Keep the project's voice from the original post; adjust length and format, not the message.
- Each version must fit its character limit with room to spare.
- British English spelling.
- Return one version per account, using the account ids you're given.`;
}

/** Returns a version of the text per account id, or an error message the composer can show. */
export async function tailorPost(ws: Workspace, body: string, accounts: { id: string; label: string; platform: string }[]) {
  const targets: Target[] = accounts.flatMap((a) => {
    const platform = getPlatform(a.platform);
    return platform ? [{ id: a.id, label: a.label, platform }] : [];
  });
  if (!body.trim()) return { error: "Write the main post first; the AI adapts it for each account." };
  if (targets.length === 0) return { error: "Tick at least one account to tailor for." };

  const list = targets
    .map((t) => `- id: ${t.id}\n  account: ${t.label} on ${t.platform.name}\n  limit: ${t.platform.maxLength} characters\n  style: ${STYLE[t.platform.id] ?? "Match the platform's usual tone."}`)
    .join("\n");

  const client = new Anthropic();
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      // Rewriting a post is a light task; low effort keeps it quick.
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              versions: {
                type: "array",
                items: {
                  type: "object",
                  properties: { account_id: { type: "string" }, text: { type: "string" } },
                  required: ["account_id", "text"],
                  additionalProperties: false,
                },
              },
            },
            required: ["versions"],
            additionalProperties: false,
          },
        },
      },
      // If the request is declined, retry it on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemPrompt(ws),
      messages: [{ role: "user", content: `Original post:\n<post>\n${body}\n</post>\n\nAccounts:\n${list}` }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { error: "The Anthropic API key isn't valid. Check ANTHROPIC_API_KEY." };
    if (err instanceof Anthropic.RateLimitError) return { error: "The AI is busy right now. Try again in a minute." };
    if (err instanceof Anthropic.APIConnectionError) return { error: "Couldn't reach the AI service. Try again in a minute." };
    if (err instanceof Anthropic.APIError) return { error: `The AI request failed (${err.status}).` };
    throw err;
  }

  if (response.stop_reason === "refusal") return { error: "The AI declined to rewrite this post." };
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  let parsed: { versions: { account_id: string; text: string }[] };
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    return { error: "The AI's reply came back incomplete. Try again." };
  }

  const known = new Map(targets.map((t) => [t.id, t]));
  const overrides: Record<string, string> = {};
  const tooLong: string[] = [];
  for (const v of parsed.versions) {
    const target = known.get(v.account_id);
    if (!target || !v.text.trim()) continue;
    overrides[target.id] = v.text.trim();
    if (postLength(target.platform, v.text.trim()) > target.platform.maxLength) tooLong.push(target.label);
  }
  return { overrides, warning: tooLong.length ? `Still too long for ${tooLong.join(", ")}; trim before posting.` : undefined };
}
