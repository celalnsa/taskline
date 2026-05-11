// Relative-time formatter for task timestamps. Returns "just now",
// "3 mins ago", "1 day ago", etc. Plural / singular handled inline so
// we don't pull in a date library for one call site.
//
// All timestamps in the API are int64 unix-millis (see model.go) — the
// caller passes that directly; `now` defaults to Date.now() but is
// injectable for tests.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

type Unit = "min" | "hour" | "day" | "week" | "month" | "year";

function pick(value: number, unit: Unit): string {
  const v = Math.floor(value);
  const plural = v === 1 ? unit : `${unit}s`;
  return `${v} ${plural} ago`;
}

export function formatRelativeTime(timestampMs: number, now: number = Date.now()): string {
  const diff = now - timestampMs;
  // Future timestamps shouldn't happen in normal flow, but if a client
  // clock is skewed forward we don't want to render a negative time.
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return pick(diff / MINUTE, "min");
  if (diff < DAY) return pick(diff / HOUR, "hour");
  if (diff < WEEK) return pick(diff / DAY, "day");
  if (diff < MONTH) return pick(diff / WEEK, "week");
  if (diff < YEAR) return pick(diff / MONTH, "month");
  return pick(diff / YEAR, "year");
}
