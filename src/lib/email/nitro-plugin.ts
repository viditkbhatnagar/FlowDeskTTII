import { startEmailWorker, stopEmailWorker } from "./worker";

type NitroAppLike = { hooks?: { hook(name: "close", handler: () => void): unknown } };

// srvx closes the HTTP server on SIGINT/SIGTERM but never fires nitro's "close" hook, so the
// worker is stopped here as well: the send in flight is recorded, the rest of its batch goes back
// to the queue, and the process then exits on its own (PM2's kill_timeout leaves room for that).
function stopOnSignal(signal: "SIGINT" | "SIGTERM") {
  process.once(signal, () => {
    const stopped = stopEmailWorker();
    // Nobody else handles the signal (no srvx): keep Node's default of exiting on it.
    if (process.listenerCount(signal) === 0) {
      void stopped.finally(() => process.kill(process.pid, signal));
    }
  });
}

// Registered in vite.config.ts (nitro.plugins). Nitro runs plugins at boot, whereas the SSR
// entry, src/server.ts, is imported lazily on the first request, so this is what makes the
// built server start its worker without waiting for traffic.
export default function emailWorkerPlugin(nitroApp: NitroAppLike): void {
  if (startEmailWorker()) {
    stopOnSignal("SIGINT");
    stopOnSignal("SIGTERM");
  }
  nitroApp.hooks?.hook("close", () => void stopEmailWorker());
}
