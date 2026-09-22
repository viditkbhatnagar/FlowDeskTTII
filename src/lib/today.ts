/**
 * "Today", in the organization's timezone.
 *
 * Every due-date comparison used `new Date().toISOString().slice(0, 10)`, which
 * is the UTC calendar date. The organization's timezone was fetched from the
 * database and then never used, so for the upCarrera organization (Asia/Dubai)
 * the day rolled over at 04:00 local — a task due today read as overdue for the
 * first four hours of every working morning, and "Due Today" counted the wrong
 * day's work.
 *
 * Intl.DateTimeFormat with en-CA gives an ISO-shaped yyyy-mm-dd directly, which
 * is the same format the date columns are stored and compared in.
 */
export function todayIn(timezone?: string): string {
  if (!timezone) return new Date().toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // An unknown timezone must not take the dashboard down with it.
    return new Date().toISOString().slice(0, 10);
  }
}
