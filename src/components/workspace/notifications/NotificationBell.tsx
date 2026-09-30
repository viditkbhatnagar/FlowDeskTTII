import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bell, CheckCheck, Loader2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { fullTime, timeAgo } from "@/components/workspace/task-detail/utils";
import {
  bellLabel,
  describeNotification,
  unreadBadge,
  type InAppNotification,
} from "@/lib/in-app-notifications";
import { cn } from "@/lib/utils";
import { useNotifications, type NotificationsStatus } from "./NotificationsProvider";

const HEADING_ID = "notifications-heading";
const SOUND_SWITCH_ID = "notifications-sound";
/** "3 minutes ago" goes stale while the list is open; redraw it this often. */
const CLOCK_TICK_MS = 60_000;

/**
 * The bell in the header: an unread badge, and a pop-over listing the latest
 * notifications. Opening one marks it read and goes to the task or project.
 */
export function NotificationBell() {
  const {
    items,
    unreadCount,
    status,
    panelOpen,
    setPanelOpen,
    markAllRead,
    retry,
    soundOn,
    setSoundOn,
  } = useNotifications();
  const badge = unreadBadge(unreadCount);

  return (
    <Popover open={panelOpen} onOpenChange={setPanelOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative shrink-0 text-muted-foreground"
          aria-label={bellLabel(unreadCount)}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {badge && (
            <span
              aria-hidden="true"
              className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none tabular-nums text-destructive-foreground ring-2 ring-background"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        aria-labelledby={HEADING_ID}
        className="w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0 shadow-[var(--shadow-card)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 id={HEADING_ID} className="text-sm font-semibold">
            Notifications
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            <CheckCheck aria-hidden="true" /> Mark all read
          </Button>
        </div>

        <NotificationList items={items} status={status} onRetry={retry} />

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
          <label
            htmlFor={SOUND_SWITCH_ID}
            className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
          >
            {soundOn ? (
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Sound for new notifications
          </label>
          <Switch id={SOUND_SWITCH_ID} checked={soundOn} onCheckedChange={setSoundOn} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationList({
  items,
  status,
  onRetry,
}: {
  items: InAppNotification[];
  status: NotificationsStatus;
  onRetry: () => void;
}) {
  const { open, openingId } = useNotifications();
  const listRef = useRef<HTMLUListElement>(null);
  const [, setClock] = useState(0);

  // Mounted only while the pop-over is open.
  useEffect(() => {
    const timer = setInterval(() => setClock((tick) => tick + 1), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!items.length) {
    if (status === "loading") {
      return (
        <p
          role="status"
          className="flex items-center justify-center gap-2 px-4 py-10 text-xs text-muted-foreground"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading notifications…
        </p>
      );
    }
    if (status === "error") {
      return (
        <div role="status" className="space-y-3 px-4 py-8 text-center">
          <p className="text-xs text-muted-foreground">Notifications couldn't be loaded.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="h-7 text-xs"
          >
            Try again
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center px-6 py-10 text-center">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10"
          aria-hidden="true"
        >
          <Bell className="h-4 w-4 text-primary" />
        </span>
        <p className="mt-3 text-sm font-medium">You're all caught up</p>
        <p className="mt-1 text-xs text-muted-foreground">
          When someone gives you a task, moves your work along or comments on it, you'll see it
          here.
        </p>
      </div>
    );
  }

  // Arrow keys, Home and End move between notifications; Tab still leaves the list.
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const { key } = event;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-notification]") ?? [],
    );
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const last = buttons.length - 1;
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? last
          : key === "ArrowDown"
            ? Math.min(index + 1, last)
            : Math.max(index - 1, 0);
    buttons[next]?.focus();
  };

  return (
    <ul
      ref={listRef}
      aria-labelledby={HEADING_ID}
      onKeyDown={onKeyDown}
      className="max-h-[min(26rem,60vh)] divide-y divide-border/60 overflow-y-auto overscroll-contain"
    >
      {items.map((notification) => {
        const view = describeNotification(notification);
        const unread = !notification.read_at;
        const opening = openingId === notification.id;
        return (
          <li key={notification.id}>
            <button
              type="button"
              data-notification
              onClick={() => void open(notification)}
              aria-busy={opening || undefined}
              className={cn(
                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                unread && "bg-primary/[0.04]",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  unread ? "bg-primary" : "bg-transparent",
                )}
              />
              <span className="min-w-0 flex-1">
                {unread && <span className="sr-only">Unread: </span>}
                <span
                  className={cn(
                    "block break-words text-xs leading-snug",
                    unread ? "font-medium" : "text-foreground/80",
                  )}
                >
                  {view.title}
                </span>
                {view.description && (
                  <span className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
                    {view.description}
                  </span>
                )}
                <time
                  dateTime={notification.created_at}
                  title={fullTime(notification.created_at)}
                  className="mt-1 block text-[10px] text-muted-foreground"
                >
                  {timeAgo(notification.created_at)}
                </time>
              </span>
              {opening && (
                <Loader2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
