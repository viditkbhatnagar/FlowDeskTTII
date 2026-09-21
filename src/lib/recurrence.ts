import { addDays, addMonths, addWeeks, addYears, format } from "date-fns";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurrenceCreationMode = "on_schedule" | "after_completion";
export type RecurrenceEndMode = "never" | "on_date" | "after_count";
export type MonthlyPattern = "day_of_month" | "weekday_pattern";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  weekdays: number[];
  monthlyPattern: MonthlyPattern;
  creationMode: RecurrenceCreationMode;
  endMode: RecurrenceEndMode;
  endDate?: string;
  maxOccurrences?: number;
}

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function nextRecurrenceDate(currentIso: string, rule: RecurrenceRule) {
  const current = new Date(`${currentIso.slice(0, 10)}T12:00:00`);
  if (rule.frequency === "daily") return format(addDays(current, rule.interval), "yyyy-MM-dd");
  if (rule.frequency === "weekly") {
    for (let offset = 1; offset <= 7 * rule.interval; offset += 1) {
      const candidate = addDays(current, offset);
      if (rule.weekdays.includes(candidate.getDay())) return format(candidate, "yyyy-MM-dd");
    }
    return format(addWeeks(current, rule.interval), "yyyy-MM-dd");
  }
  if (rule.frequency === "monthly") return format(addMonths(current, rule.interval), "yyyy-MM-dd");
  return format(addYears(current, rule.interval), "yyyy-MM-dd");
}

export function recurrenceSummary(rule: RecurrenceRule, startDate?: string) {
  const unit = rule.frequency === "daily" ? "day" : rule.frequency === "weekly" ? "week" : rule.frequency === "monthly" ? "month" : "year";
  let summary = `Repeats every ${rule.interval === 1 ? unit : `${rule.interval} ${unit}s`}`;
  if (rule.frequency === "weekly" && rule.weekdays.length) {
    summary += ` on ${rule.weekdays.map((day) => weekdayNames[day]).join(", ")}`;
  }
  if (rule.frequency === "monthly") {
    summary += rule.monthlyPattern === "weekday_pattern" ? " on the same weekday pattern" : " on the same day of the month";
  }
  if (rule.endMode === "on_date" && rule.endDate) summary += ` until ${format(new Date(`${rule.endDate}T12:00:00`), "MMM d, yyyy")}`;
  if (rule.endMode === "after_count" && rule.maxOccurrences) summary += ` for ${rule.maxOccurrences} occurrences`;
  summary += rule.creationMode === "after_completion" ? "; next task is created after completion." : "; new tasks are created on schedule.";
  if (!startDate) return summary;
  return summary;
}