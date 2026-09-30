/**
 * Keeps the signed-in person's in-app notifications current for the bell, and
 * announces each new one with a pop-up and a chime (QA, 29 Sep 2026: people only
 * learnt that work had moved when a colleague messaged them on WhatsApp).
 *
 * Live through Supabase Realtime, with polling behind it: every 30 s while the
 * live channel is down, every 2 min while it is up (a safety net for a missed
 * event), only while the tab is visible, and straight away when the tab comes
 * back into view or the network returns. The first load is the backlog: it fills
 * the bell without a pop-up or a sound.
 *
 * Everything that touches the browser runs in effects and handlers, never during
 * render: the app is server-rendered.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-data";
import {
  countUnreadNotifications,
  describeNotification,
  listNotifications,
  listNotificationsSince,
  markAllNotificationsRead,
  markNotificationRead,
  mergeNotifications,
  newestCreatedAt,
  timestampMs,
  toNotification,
  unseenUnread,
  type InAppNotification,
} from "@/lib/in-app-notifications";
import {
  createChimeLeader,
  isChimeUnlocked,
  isSoundPreferenceEvent,
  playChime,
  readSoundPreference,
  unlockChime,
  writeSoundPreference,
  type ChimeLeader,
} from "./chime";

export type NotificationsStatus = "loading" | "ready" | "error";

type NotificationsContextValue = {
  /** The latest notifications, newest first. */
  items: InAppNotification[];
  /** Unread in all, which can be more than `items` holds. */
  unreadCount: number;
  /** "error" only while nothing has loaded; a later failure keeps what is shown. */
  status: NotificationsStatus;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** The bell's pop-over, here so a pop-up can open it. */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** The notification being opened while the task list reloads first. */
  openingId: string | null;
  /** Marks it read, reloads the tasks it may point at, and goes there. */
  open: (notification: InAppNotification) => Promise<void>;
  markAllRead: () => Promise<void>;
  retry: () => void;
};

const POLL_WHILE_DOWN_MS = 30_000;
const POLL_WHILE_LIVE_MS = 120_000;
/** Realtime events come in bursts (Mark all read in another tab sends one per row). */
const RECOUNT_DELAY_MS = 400;
const TASKS_RELOAD_DELAY_MS = 800;
/**
 * created_at is the writing transaction's start time, so a row can commit after
 * a newer one was already seen. Catching up re-reads this far back; merging by
 * id drops the repeats.
 */
const CATCH_UP_MARGIN_MS = 2 * 60_000;
/** More at once than this (back from a sleep, say) become one summary pop-up. */
const MAX_SEPARATE_TOASTS = 3;
const MIN_CHIME_GAP_MS = 2_000;
/** Dashboards, Team Tasks and project activity reload on this (see workspace-data.tsx). */
const WORK_CHANGED_EVENT = "flowdesk-work-changed";

let channelSerial = 0;

const toastId = (notificationId: string) => `notification:${notificationId}`;

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { refresh } = useWorkspace();
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [status, setStatus] = useState<NotificationsStatus>("loading");
  // On until the saved choice is read after mount, so server and client render alike.
  const [soundOn, setSoundOnState] = useState(true);
  const [panelOpen, setPanelOpenState] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Latest values for callbacks that must not go stale between renders.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const unreadRef = useRef(unreadCount);
  unreadRef.current = unreadCount;
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // Bumped by every local mark-read, so an unread count fetched before it cannot
  // put the old number back on the badge.
  const writeSeq = useRef(0);
  const syncRef = useRef<() => void>(() => undefined);
  const recountRef = useRef<() => void>(() => undefined);
  const openRef = useRef<(notification: InAppNotification) => Promise<void>>(async () => {});
  const openingRef = useRef<string | null>(null);
  const leaderRef = useRef<ChimeLeader | null>(null);
  const lastChimeAt = useRef(0);

  // The sound setting, kept in step across tabs.
  useEffect(() => {
    setSoundOnState(readSoundPreference());
    const onStorage = (event: StorageEvent) => {
      if (isSoundPreferenceEvent(event)) setSoundOnState(readSoundPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Browsers block audio until the person interacts with the page, so the chime
  // is unlocked on the first pointerdown or keydown anywhere.
  useEffect(() => {
    const leader = createChimeLeader();
    leaderRef.current = leader;
    const stopListening = () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
    function unlock() {
      void unlockChime().then((ready) => {
        if (!ready) return;
        leader.volunteer();
        stopListening();
      });
    }
    if (isChimeUnlocked()) {
      leader.volunteer();
    } else {
      window.addEventListener("pointerdown", unlock, true);
      window.addEventListener("keydown", unlock, true);
    }
    return () => {
      stopListening();
      leader.dispose();
      if (leaderRef.current === leader) leaderRef.current = null;
    };
  }, []);

  const chime = useCallback((key: string) => {
    const leader = leaderRef.current;
    if (!soundOnRef.current || !leader) return;
    void leader.claim(key).then((mine) => {
      const now = Date.now();
      if (!mine || !soundOnRef.current || now - lastChimeAt.current < MIN_CHIME_GAP_MS) return;
      lastChimeAt.current = now;
      playChime();
    });
  }, []);

  // Loading, live updates and polling for this person.
  useEffect(() => {
    let disposed = false;
    let live = false;
    let liveWarned = false;
    // Until the first load lands, only live events are news; the backlog is not.
    let baseline = false;
    let newest: string | undefined;
    let syncing: Promise<void> | null = null;
    let syncAgain = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let recountTimer: ReturnType<typeof setTimeout> | undefined;
    let tasksTimer: ReturnType<typeof setTimeout> | undefined;
    // Every id this tab has seen, so a notification pops up once however it arrives.
    const known = new Set<string>();

    const announce = (fresh: InAppNotification[]) => {
      window.dispatchEvent(new Event(WORK_CHANGED_EVENT));
      // My Tasks and the boards read the shared task list, which does not listen
      // for that event. Reload it once per burst.
      clearTimeout(tasksTimer);
      tasksTimer = setTimeout(() => {
        void refreshRef
          .current()
          .catch((error: unknown) =>
            console.error("[flowdesk] notifications: could not reload tasks", error),
          );
      }, TASKS_RELOAD_DELAY_MS);

      if (fresh.length > MAX_SEPARATE_TOASTS) {
        toast(`${fresh.length} new notifications`, {
          id: "notifications:summary",
          description: describeNotification(fresh[fresh.length - 1]).title,
          action: { label: "View", onClick: () => setPanelOpenState(true) },
        });
      } else {
        // Oldest first, so the newest ends up on top of the stack.
        for (const notification of fresh) {
          const view = describeNotification(notification);
          toast(view.title, {
            id: toastId(notification.id),
            description: view.description || undefined,
            action: { label: "Open", onClick: () => void openRef.current(notification) },
          });
        }
      }
      chime(fresh[fresh.length - 1].id);
    };

    const absorb = (rows: InAppNotification[], fromLive: boolean) => {
      if (disposed || !rows.length) return;
      const fresh = fromLive || baseline ? unseenUnread(known, rows) : [];
      for (const row of rows) known.add(row.id);
      newest = newestCreatedAt(rows, newest);
      setItems((current) => mergeNotifications(current, rows));
      if (fresh.length) announce(fresh);
    };

    const recount = async () => {
      const seq = writeSeq.current;
      const count = await countUnreadNotifications(userId);
      if (disposed || count === null || seq !== writeSeq.current) return;
      setUnreadCount(count);
    };
    const scheduleRecount = () => {
      clearTimeout(recountTimer);
      recountTimer = setTimeout(() => void recount(), RECOUNT_DELAY_MS);
    };

    const load = async () => {
      const seq = writeSeq.current;
      const [rows, count] = await Promise.all([
        listNotifications(userId),
        countUnreadNotifications(userId),
      ]);
      if (disposed) return;
      if (rows) {
        absorb(rows, false);
        baseline = true;
        setStatus("ready");
      } else {
        // Keep showing what loaded before; say it failed only when there is nothing.
        setStatus((current) => (current === "ready" ? current : "error"));
      }
      if (count !== null && seq === writeSeq.current) setUnreadCount(count);
    };

    const sync = () => {
      if (disposed) return;
      if (syncing) {
        syncAgain = true;
        return;
      }
      syncing = load()
        .catch((error: unknown) => console.error("[flowdesk] notifications: sync failed", error))
        .finally(() => {
          syncing = null;
          if (syncAgain) {
            syncAgain = false;
            sync();
          }
        });
    };

    // Back on the live channel: fetch what arrived while it was down.
    const catchUp = async () => {
      if (!baseline || !newest) {
        if (!syncing) sync();
        return;
      }
      const since = new Date(timestampMs(newest) - CATCH_UP_MARGIN_MS).toISOString();
      const rows = await listNotificationsSince(userId, since);
      if (disposed || !rows) return;
      absorb(rows, false);
      scheduleRecount();
    };

    const schedulePoll = () => {
      clearTimeout(pollTimer);
      pollTimer = setTimeout(
        () => {
          if (document.visibilityState === "visible") sync();
          schedulePoll();
        },
        live ? POLL_WHILE_LIVE_MS : POLL_WHILE_DOWN_MS,
      );
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      sync();
      schedulePoll();
    };
    const onOnline = () => {
      sync();
      schedulePoll();
    };

    const onInsert = (raw: unknown) => {
      const row = toNotification(raw);
      if (!row || disposed) return;
      const addsUnread = !known.has(row.id) && !row.read_at;
      absorb([row], true);
      if (addsUnread) setUnreadCount((count) => count + 1);
      scheduleRecount();
    };
    // Read in another tab: follow it here.
    const onUpdate = (raw: unknown) => {
      const row = toNotification(raw);
      if (!row || disposed) return;
      setItems((current) =>
        current.some((item) => item.id === row.id) ? mergeNotifications(current, [row]) : current,
      );
      if (row.read_at) toast.dismiss(toastId(row.id));
      scheduleRecount();
    };

    let channel: RealtimeChannel | null = null;
    try {
      const filter = `recipient_id=eq.${userId}`;
      // A new topic for each subscription. supabase.channel() hands back an
      // existing channel with the same topic, and one still leaving (this effect
      // re-running under StrictMode in dev, or for another user) refuses new
      // listeners, then removes every channel of that topic when it closes.
      channelSerial += 1;
      channel = supabase
        .channel(`notifications:${userId}:${channelSerial}`)
        .on<Record<string, unknown>>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter },
          (payload) => onInsert(payload.new),
        )
        .on<Record<string, unknown>>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter },
          (payload) => onUpdate(payload.new),
        )
        .subscribe((state, error) => {
          if (disposed) return;
          const wasLive = live;
          live = state === "SUBSCRIBED";
          if (live) {
            void catchUp();
          } else if ((state === "CHANNEL_ERROR" || state === "TIMED_OUT") && !liveWarned) {
            liveWarned = true;
            console.warn(
              "[flowdesk] notifications: live updates unavailable, checking every 30 s instead",
              error,
            );
          }
          if (live !== wasLive) schedulePoll();
        });
    } catch (error) {
      // Polling alone still keeps the bell current.
      console.warn("[flowdesk] notifications: live updates unavailable", error);
    }

    syncRef.current = sync;
    recountRef.current = scheduleRecount;
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    sync();
    schedulePoll();

    return () => {
      disposed = true;
      clearTimeout(pollTimer);
      clearTimeout(recountTimer);
      clearTimeout(tasksTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      syncRef.current = () => undefined;
      recountRef.current = () => undefined;
      if (channel) void supabase.removeChannel(channel);
      // Nothing of this person's may show for the next one.
      setItems([]);
      setUnreadCount(0);
      setStatus("loading");
    };
  }, [userId, chime]);

  const markRead = useCallback(async (id: string) => {
    const target = itemsRef.current.find((item) => item.id === id);
    if (target?.read_at) return;
    const readAt = new Date().toISOString();
    writeSeq.current += 1;
    toast.dismiss(toastId(id));
    if (target) {
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, read_at: readAt } : item)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    const ok = await markNotificationRead(id, readAt);
    if (!target) {
      recountRef.current();
      return;
    }
    if (ok) return;
    // Put it back: the dot should not claim it was read when the database says not.
    writeSeq.current += 1;
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.read_at === readAt ? { ...item, read_at: null } : item,
      ),
    );
    setUnreadCount((count) => count + 1);
  }, []);

  const markAllRead = useCallback(async () => {
    const unreadBefore = unreadRef.current;
    const wasUnread = new Set(
      itemsRef.current.filter((item) => !item.read_at).map((item) => item.id),
    );
    if (!unreadBefore && !wasUnread.size) return;
    const readAt = new Date().toISOString();
    writeSeq.current += 1;
    for (const id of wasUnread) toast.dismiss(toastId(id));
    setItems((current) =>
      current.map((item) => (item.read_at ? item : { ...item, read_at: readAt })),
    );
    setUnreadCount(0);
    if (await markAllNotificationsRead(userId, readAt)) return;
    writeSeq.current += 1;
    setItems((current) =>
      current.map((item) =>
        wasUnread.has(item.id) && item.read_at === readAt ? { ...item, read_at: null } : item,
      ),
    );
    setUnreadCount(unreadBefore);
    toast.error("Couldn't mark your notifications as read.", {
      description: "Check your connection and try again.",
    });
  }, [userId]);

  const open = useCallback(
    async (notification: InAppNotification) => {
      if (openingRef.current) return;
      openingRef.current = notification.id;
      setOpeningId(notification.id);
      try {
        void markRead(notification.id);
        // A task created after this page loaded is not in the task list yet, and
        // My Tasks would say it isn't available. Reload first.
        if (notification.task_id) {
          try {
            await refreshRef.current();
          } catch (error) {
            console.error("[flowdesk] notifications: could not reload tasks before opening", error);
          }
        }
        setPanelOpenState(false);
        await navigate({ href: describeNotification(notification).href });
      } catch (error) {
        console.error("[flowdesk] notifications: could not open a notification", error);
      } finally {
        openingRef.current = null;
        setOpeningId(null);
      }
    },
    [markRead, navigate],
  );
  openRef.current = open;

  const setPanelOpen = useCallback((next: boolean) => {
    setPanelOpenState(next);
    // Opening the bell is a good moment to check for anything missed.
    if (next) syncRef.current();
  }, []);

  const setSoundOn = useCallback((on: boolean) => {
    setSoundOnState(on);
    writeSoundPreference(on);
    // The switch is a click, so audio can start: play it once so they know the sound.
    if (on) void unlockChime().then((ready) => ready && playChime());
  }, []);

  const retry = useCallback(() => {
    setStatus((current) => (current === "error" ? "loading" : current));
    syncRef.current();
  }, []);

  // Never fewer than the list shows: the count is a separate query and can fail on its own.
  const shownUnread = useMemo(() => items.filter((item) => !item.read_at).length, [items]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      items,
      unreadCount: Math.max(unreadCount, shownUnread),
      status,
      soundOn,
      setSoundOn,
      panelOpen,
      setPanelOpen,
      openingId,
      open,
      markAllRead,
      retry,
    }),
    [
      items,
      unreadCount,
      shownUnread,
      status,
      soundOn,
      setSoundOn,
      panelOpen,
      setPanelOpen,
      openingId,
      open,
      markAllRead,
      retry,
    ],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationsProvider");
  return context;
}
