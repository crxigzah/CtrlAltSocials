"use client";

import { PlatformIcon } from "@/components/platform-icon";
import { getPlatform, threadTexts, type PlatformId } from "@/lib/platforms/catalog";

// Rough previews of how a post will look on each platform: layout, truncation and
// thread splitting, not pixel-perfect copies of each app.

export type PreviewBrand = { name: string; handle: string | null; color: string };
export type PreviewMedia = { url: string; mime: string };

/** Where each platform cuts a long caption behind "more". */
const FOLD: Partial<Record<PlatformId, number>> = { instagram: 125, facebook: 480, tiktok: 100, youtube: 120 };

function RichText({ text }: { text: string }) {
  // Links, hashtags and mentions in the accent colour, as most apps show them.
  const parts = text.split(/(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+|@[\w.]+)/u);
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => (/^(https?:|#|@)/.test(p) ? <span key={i} className="text-accent">{p}</span> : p))}
    </span>
  );
}

function Folded({ text, at }: { text: string; at?: number }) {
  if (!at || [...text].length <= at) return <RichText text={text} />;
  return (
    <>
      <RichText text={[...text].slice(0, at).join("").trimEnd()} />
      <span className="text-subtle">… more</span>
    </>
  );
}

function Avatar({ brand, size = 32 }: { brand: PreviewBrand; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: brand.color, width: size, height: size, fontSize: size * 0.42 }}
    >
      {brand.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function MediaGrid({ media, square }: { media: PreviewMedia[]; square?: boolean }) {
  if (!media.length) return null;
  const shown = square ? media.slice(0, 1) : media.slice(0, 4);
  return (
    <div className={`mt-2 grid gap-0.5 overflow-hidden rounded-lg border border-line ${shown.length > 1 ? "grid-cols-2" : ""}`}>
      {shown.map((m, i) => (
        <div key={i} className={`relative bg-raised ${square ? "aspect-square" : shown.length > 1 ? "aspect-square" : "aspect-video"}`}>
          {m.mime.startsWith("video/") ? (
            <video src={m.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.url} alt="" className="h-full w-full object-cover" />
          )}
          {square && media.length > 1 && i === 0 && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 text-xs text-white">1/{media.length}</span>}
        </div>
      ))}
    </div>
  );
}

export function PostPreview({ platform, text, parts, media, brand }: { platform: PlatformId; text: string; parts: string[]; media: PreviewMedia[]; brand: PreviewBrand }) {
  const p = getPlatform(platform)!;
  const texts = threadTexts(p, text, parts);
  const handle = brand.handle ? `@${brand.handle}` : brand.name;

  if (platform === "instagram") {
    return (
      <div className="max-w-sm rounded-lg border border-line bg-bg p-3 text-sm">
        <div className="mb-2 flex items-center gap-2"><Avatar brand={brand} size={28} /><span className="font-semibold">{brand.handle ?? brand.name}</span></div>
        <MediaGrid media={media} square />
        <p className="mt-2"><span className="mr-1 font-semibold">{brand.handle ?? brand.name}</span><Folded text={texts[0]} at={FOLD.instagram} /></p>
      </div>
    );
  }
  if (platform === "youtube" || platform === "tiktok") {
    const [title, ...rest] = texts[0].split("\n");
    return (
      <div className="max-w-sm rounded-lg border border-line bg-bg p-3 text-sm">
        <MediaGrid media={media.filter((m) => m.mime.startsWith("video/"))} />
        {platform === "youtube" ? (
          <>
            <p className="mt-2 font-semibold">{title || <span className="text-bad">No title</span>}</p>
            <p className="text-xs text-muted">{brand.name}</p>
            {rest.join("\n").trim() && <p className="mt-1 text-xs text-muted"><Folded text={rest.join("\n").trim()} at={FOLD.youtube} /></p>}
          </>
        ) : (
          <p className="mt-2"><span className="mr-1 font-semibold">{handle}</span><Folded text={texts[0]} at={FOLD.tiktok} /></p>
        )}
      </div>
    );
  }
  if (platform === "reddit") {
    const [title, ...rest] = texts[0].split("\n");
    return (
      <div className="max-w-md rounded-lg border border-line bg-bg p-3 text-sm">
        <p className="text-xs text-muted">r/… · u/{brand.handle ?? "you"}</p>
        <p className="mt-1 text-base font-semibold">{title || <span className="text-bad">No title</span>}</p>
        {rest.join("\n").trim() && <p className="mt-1 text-muted"><RichText text={rest.join("\n").trim()} /></p>}
      </div>
    );
  }
  if (platform === "discord") {
    return (
      <div className="flex max-w-md gap-3 rounded-lg border border-line bg-bg p-3 text-sm">
        <Avatar brand={brand} size={36} />
        <div className="min-w-0">
          <p><span className="font-semibold">{brand.name}</span> <span className="rounded bg-accent/20 px-1 text-[10px] text-accent">APP</span></p>
          <RichText text={texts[0]} />
          <MediaGrid media={media} />
        </div>
      </div>
    );
  }
  // X, Bluesky, Threads, Facebook: a feed post, with thread parts as connected replies.
  return (
    <div className="max-w-md rounded-lg border border-line bg-bg p-3 text-sm">
      {texts.map((t, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Avatar brand={brand} />
            {i < texts.length - 1 && <span className="my-1 w-0.5 flex-1 bg-line" />}
          </div>
          <div className="min-w-0 flex-1 pb-3">
            <p className="text-xs"><span className="font-semibold text-fg">{brand.name}</span> <span className="text-muted">{platform === "facebook" ? "" : handle}</span></p>
            <Folded text={t} at={FOLD[platform]} />
            {i === 0 && <MediaGrid media={media} />}
          </div>
        </div>
      ))}
      <p className="flex items-center gap-1 text-[11px] text-subtle"><PlatformIcon platform={platform} size={12} /> Rough preview of {p.name}</p>
    </div>
  );
}
