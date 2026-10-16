import type { PlatformId } from "@/lib/platforms/catalog";

// Brand-coloured initials rather than logos: no trademark assets to keep updated.
const STYLE: Record<PlatformId, { bg: string; text: string }> = {
  bluesky: { bg: "#1185fe", text: "B" },
  discord: { bg: "#5865f2", text: "D" },
  x: { bg: "#000000", text: "X" },
  instagram: { bg: "#d62976", text: "IG" },
  facebook: { bg: "#1877f2", text: "f" },
  threads: { bg: "#101010", text: "@" },
  tiktok: { bg: "#111111", text: "TT" },
  youtube: { bg: "#ff0000", text: "YT" },
  reddit: { bg: "#ff4500", text: "R" },
};

export function PlatformIcon({ platform, size = 28 }: { platform: PlatformId; size?: number }) {
  const s = STYLE[platform];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 font-bold text-white"
      style={{ background: s.bg, width: size, height: size, fontSize: size * 0.4 }}
    >
      {s.text}
    </span>
  );
}
