// Hand-rolled column formatting for the CLI's list views (`docs list`,
// `tabs list`). No table dependency — the repo has zero runtime deps.
//
// Everything measures **terminal display width**, not string length: CJK and
// emoji occupy two columns, Thai vowels and combining marks occupy zero, and
// ANSI escapes occupy none. Padding on `.length` would visibly skew a column the
// moment a non-Latin title showed up. Bun ships `stringWidth` natively, so this
// costs nothing.
//
// Colors are applied to whole lines by the caller, never inside a padded cell —
// otherwise the escape bytes land in the middle of a measured string.

import { link } from "./ui";

/** Display width in terminal columns (CJK/emoji 2, combining marks 0, ANSI 0). */
export function width(s: string): number {
  return Bun.stringWidth(s);
}

/** Width of a column: the header, or the widest cell under it. */
export function colWidth(
  header: string,
  rows: Array<Record<string, string>>,
  key: string,
): number {
  return Math.max(width(header), ...rows.map((r) => width(r[key]!)));
}

export function padEnd(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - width(s)));
}

/**
 * Like padEnd, but wraps the visible text in an OSC 8 hyperlink when `url` is
 * given. The pad is computed from the plain text's display width, then appended
 * *outside* the link, so the (zero-width) escape bytes never break alignment.
 */
export function padEndLink(s: string, w: number, url?: string): string {
  const pad = " ".repeat(Math.max(0, w - width(s)));
  return (url ? link(url, s) : s) + pad;
}

/**
 * Truncate to a display width of `max` columns (not code units), appending "…".
 * Walks grapheme clusters (Intl.Segmenter) so a wide char, emoji, or Thai vowel
 * is never cut in half — and reserves one column for the ellipsis.
 */
export function truncate(s: string, max: number): string {
  if (width(s) <= max) return s;
  let out = "";
  let w = 0;
  for (const { segment } of new Intl.Segmenter().segment(s)) {
    const sw = width(segment);
    if (w + sw > max - 1) break; // leave room for the "…"
    out += segment;
    w += sw;
  }
  return out + "…";
}

export function formatBytes(n: number): string {
  if (!n || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** ISO-8601 → `YYYY-MM-DD`, passing through anything unparseable. */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * ISO-8601 → "just now" / "3 hours ago" / "2 days ago". Used where the age of
 * the data is the point (a saved snapshot on disk can be arbitrarily stale, and
 * a bare timestamp makes the reader do that subtraction themselves).
 */
export function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";

  const plural = (n: number, unit: string): string =>
    `${n} ${unit}${n === 1 ? "" : "s"} ago`;

  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return plural(mins, "minute");
  const hours = Math.floor(mins / 60);
  if (hours < 24) return plural(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return plural(days, "day");
  return plural(Math.floor(days / 7), "week");
}
