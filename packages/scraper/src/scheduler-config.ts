/**
 * Scheduling helpers shared by `scheduler.ts`, the CLI and the GitHub Action so
 * the "every 3–5 days" cadence lives in exactly one place.
 */

export const DEFAULT_SCRAPE_INTERVAL_DAYS = 3;
export const MIN_SCRAPE_INTERVAL_DAYS = 1;
export const MAX_SCRAPE_INTERVAL_DAYS = 7;
/** Panama is UTC-5 all year round (no DST). 08:00 UTC = 03:00 in Panama. */
export const SCRAPE_HOUR_UTC = 8;

/** Reads and validates `SCRAPE_INTERVAL_DAYS` (default 3, clamped to 1..7). */
export function getScrapeIntervalDays(raw: string | number | null | undefined = process.env.SCRAPE_INTERVAL_DAYS): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCRAPE_INTERVAL_DAYS;
  return Math.min(MAX_SCRAPE_INTERVAL_DAYS, Math.max(MIN_SCRAPE_INTERVAL_DAYS, Math.trunc(parsed)));
}

/** Next scheduled run after `from`, at 08:00 UTC, every `intervalDays` days. */
export function nextScrapeDate(from: Date, intervalDays = getScrapeIntervalDays()): Date {
  const intervalMs = intervalDays * 24 * 60 * 60 * 1000;
  const anchor = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), SCRAPE_HOUR_UTC, 0, 0);

  if (anchor > from.getTime()) return new Date(anchor);

  // Align to the interval grid anchored on the Unix epoch so restarts keep the
  // same cadence instead of drifting forward on every reboot.
  const periods = Math.floor((from.getTime() - anchor) / intervalMs) + 1;
  return new Date(anchor + periods * intervalMs);
}

/** Human readable representation in Panama time. */
export function formatPanama(date: Date): string {
  return new Intl.DateTimeFormat("es-PA", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "America/Panama",
  }).format(date);
}
