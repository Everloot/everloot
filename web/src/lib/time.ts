/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utcDate = (at: string | null | undefined): Date | null => (at && Number.isFinite(Date.parse(at)) ? new Date(at) : null);

/** "Nov 28, 2026": a day, the site's one day form, in UTC. Takes an ISO time or a bare "2026-11-28"; null when unreadable. */
export function utcDay(at: string | null | undefined): string | null {
  const d = utcDate(at);
  return d && `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "Nov 28": a chart tick's day, where the year is plain from the chart; null when unreadable. */
export function shortDay(at: string | null | undefined): string | null {
  const d = utcDate(at);
  return d && `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Nov 28, 2026, 03:11 UTC": a moment, the site's one timestamp form; null when unreadable. */
export function utcStamp(at: string | null | undefined): string | null {
  const d = utcDate(at);
  return d && `${utcDay(at)}, ${d.toISOString().slice(11, 16)} UTC`;
}
