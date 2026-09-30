/**
 * The notification chime: two soft notes made with the Web Audio API, so there is
 * no audio file to ship or cache.
 *
 * Browsers only let a page start audio after the person has interacted with it,
 * so the AudioContext is created on the first pointerdown or keydown (unlockChime)
 * and a notification before that stays silent. With several tabs open only one
 * plays it (createChimeLeader). Everything here touches the browser, so it is only
 * called from effects and event handlers, never at import or during render (the
 * app is server-rendered).
 */

const SOUND_PREFERENCE_KEY = "flowdesk-notification-sound";
const LEADER_LOCK = "flowdesk-notification-chime";
const CLAIM_CHANNEL = "flowdesk-notification-chime";
/** How long a tab without Web Locks waits to hear whether another tab played it. */
const CLAIM_JITTER_MS = 150;
/** How long another tab's claim on a notification is remembered. */
const CLAIM_MEMORY_MS = 10_000;

/** A rising fourth, E5 then A5: noticeable, not alarming. */
const NOTES = [
  { frequency: 659.25, at: 0 },
  { frequency: 880, at: 0.13 },
] as const;
const NOTE_LENGTH_S = 0.5;
const VOLUME = 0.16;

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;
let failureLogged = false;

function audioContextClass(): AudioContextClass | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext
  );
}

function logOnce(message: string, error: unknown): void {
  if (failureLogged) return;
  failureLogged = true;
  console.error(`[flowdesk] ${message}`, error);
}

/** Whether the person wants the chime. On unless they turned it off. */
export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREFERENCE_KEY) !== "off";
  } catch {
    // Storage blocked (private window): fall back to the default.
    return true;
  }
}

export function writeSoundPreference(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, on ? "on" : "off");
  } catch {
    /* storage blocked: the choice lasts until the page is closed */
  }
}

/** True when a `storage` event from another tab changed the sound setting. */
export function isSoundPreferenceEvent(event: StorageEvent): boolean {
  return event.key === SOUND_PREFERENCE_KEY || event.key === null;
}

/**
 * Creates or resumes the AudioContext. Call it from a pointerdown or keydown:
 * outside one, browsers keep it suspended. Resolves true once sound can play.
 */
export async function unlockChime(): Promise<boolean> {
  const Context = audioContextClass();
  if (!Context) return false;
  try {
    context ??= new Context();
    if (context.state !== "running") await context.resume();
    return context.state === "running";
  } catch (error) {
    logOnce("notification sound unavailable", error);
    return false;
  }
}

/** True once an earlier interaction has unlocked audio in this tab. */
export function isChimeUnlocked(): boolean {
  return context?.state === "running";
}

/** Plays the chime if audio has been unlocked; otherwise does nothing. */
export function playChime(): void {
  const audio = context;
  if (!audio || audio.state !== "running") return;
  try {
    const start = audio.currentTime + 0.02;
    const master = audio.createGain();
    master.gain.value = VOLUME;
    master.connect(audio.destination);
    NOTES.forEach(({ frequency, at }, index) => {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      // A quick attack and a long exponential fade reads as a bell, not a beep.
      envelope.gain.setValueAtTime(0.0001, start + at);
      envelope.gain.exponentialRampToValueAtTime(1, start + at + 0.015);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + at + NOTE_LENGTH_S);
      oscillator.connect(envelope).connect(master);
      oscillator.start(start + at);
      oscillator.stop(start + at + NOTE_LENGTH_S + 0.05);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        if (index === NOTES.length - 1) master.disconnect();
      };
    });
  } catch (error) {
    logOnce("could not play the notification sound", error);
  }
}

export type ChimeLeader = {
  /** Join the tabs that may play the chime; call once this tab can play sound. */
  volunteer: () => void;
  /** Resolves true when this tab should play the chime for `key` (a notification id). */
  claim: (key: string) => Promise<boolean>;
  dispose: () => void;
};

/**
 * Picks one tab to play the chime, so three open tabs do not ring three times.
 *
 * With Web Locks, the first tab that could play sound holds a lock for as long as
 * it is open and plays every chime; when it closes, the next one takes over. Tabs
 * that were never clicked cannot play sound, so they do not take part. Without
 * Web Locks, tabs announce each chime on a BroadcastChannel after a short random
 * wait, and a tab that hears another's claim first stays quiet. Without either,
 * every tab plays.
 */
export function createChimeLeader(): ChimeLeader {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const abort = new AbortController();
  let volunteered = false;
  let leader = false;
  let release: (() => void) | undefined;

  let channel: BroadcastChannel | undefined;
  const claimedElsewhere = new Map<string, number>();
  if (!locks && typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CLAIM_CHANNEL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") claimedElsewhere.set(event.data, Date.now());
      };
    } catch {
      channel = undefined;
    }
  }

  const forgetOldClaims = () => {
    const cutoff = Date.now() - CLAIM_MEMORY_MS;
    for (const [key, at] of claimedElsewhere) if (at < cutoff) claimedElsewhere.delete(key);
  };

  return {
    volunteer: () => {
      if (volunteered || !locks) return;
      volunteered = true;
      locks
        .request(LEADER_LOCK, { signal: abort.signal }, () => {
          leader = true;
          // Held until this tab closes or the provider unmounts.
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        .catch(() => {
          /* aborted on dispose while still waiting: nothing to do */
        });
    },
    claim: async (key) => {
      if (locks) return leader;
      if (!channel) return true;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * CLAIM_JITTER_MS));
      forgetOldClaims();
      if (claimedElsewhere.has(key)) return false;
      try {
        channel.postMessage(key);
      } catch {
        /* the channel closed: play anyway */
      }
      return true;
    },
    dispose: () => {
      abort.abort();
      release?.();
      leader = false;
      channel?.close();
    },
  };
}
