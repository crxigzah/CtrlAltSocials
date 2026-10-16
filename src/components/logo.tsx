/** Wordmark: the first two words as keycaps, like the shortcut the name is riffing on. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-1 text-lg font-semibold tracking-tight ${className}`}>
      <span className="keycap">Ctrl</span>
      <span className="keycap">Alt</span>
      <span className="ml-1">Socials</span>
    </span>
  );
}
