export function Avatar({ name, url, color, size = 40 }: { name: string; url?: string | null; color?: string; size?: number }) {
  return url ? (
    <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover ring-2" style={{ width: size, height: size, ["--tw-ring-color" as string]: color ?? "#c39a33" }} referrerPolicy="no-referrer" />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-ink-950"
      style={{ width: size, height: size, background: color ?? "#c39a33", fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
