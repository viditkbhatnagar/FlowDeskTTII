// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// D1 — FlowDesk is deployed to the upCarrera DigitalOcean droplet under PM2, not to
// Cloudflare Workers. The wrapper's zero-config default is `cloudflare-module`
// (defaultPreset, see node_modules/@lovable.dev/vite-tanstack-config/dist/index.js),
// which produces a Workers bundle PM2 cannot run. Pinning `node-server` makes nitro
// emit a plain Node entry at .output/server/index.mjs. Output paths are set explicitly
// so the deploy runbook (docs/06) does not depend on a nitro default.
//
// `plugins` starts the email worker at boot, because the SSR entry (src/server.ts) is only
// imported on the first request. The wrapper's type lists just preset/output/cloudflare but it
// forwards every option to nitro ({ ...userNitroOpts }), hence a named object, not a literal.
const nitroOptions = {
  preset: "node-server",
  plugins: ["./src/lib/email/nitro-plugin.ts"],
  output: {
    dir: ".output",
    serverDir: ".output/server",
    publicDir: ".output/public",
  },
};

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },

  nitro: nitroOptions,
});
