import { useState } from "react";
import { useWorkspace } from "@/lib/workspace-data";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const priorityDot: Record<string, string> = {
  low: "bg-priority-low",
  medium: "bg-priority-medium",
  high: "bg-priority-high",
  critical: "bg-priority-critical",
};

export function CalendarView() {
  const { tasks } = useWorkspace();
  const [cursor, setCursor] = useState(new Date());
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });

  const days: Date[] = [];
  let d = gridStart;
  while (d <= gridEnd) {
    days.push(d);
    d = addDays(d, 1);
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-soft)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div>
          <div className="text-sm font-semibold">{format(cursor, "MMMM yyyy")}</div>
          <div className="text-[11px] text-muted-foreground">
            Monthly schedule · color = priority
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(subMonths(cursor, 1))}
            className="rounded-md p-1.5 hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursor(new Date())}
            className="rounded-md px-2 py-1 text-xs hover:bg-accent"
          >
            Today
          </button>
          <button
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="rounded-md p-1.5 hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div
            key={d}
            className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const inMonth = isSameMonth(day, cursor);
          const dayTasks = tasks.filter((t) => isSameDay(new Date(t.dueDate), day));
          const isToday = isSameDay(day, new Date());
          return (
            <div
              key={i}
              className={cn(
                "min-h-[110px] border-r border-b border-border/70 p-2 text-xs",
                !inMonth && "bg-muted/20 text-muted-foreground/50",
                (i + 1) % 7 === 0 && "border-r-0",
              )}
            >
              <div
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-medium",
                  isToday ? "bg-primary text-primary-foreground" : "text-foreground",
                )}
              >
                {format(day, "d")}
              </div>
              <div className="mt-1 space-y-1">
                {dayTasks.slice(0, 3).map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-1.5 rounded-md bg-accent/60 px-1.5 py-1 text-[10px] truncate"
                    title={t.title}
                  >
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full shrink-0", priorityDot[t.priority])}
                    />
                    <span className="truncate">{t.title}</span>
                  </div>
                ))}
                {dayTasks.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{dayTasks.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
