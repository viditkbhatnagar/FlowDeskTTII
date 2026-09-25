// PM2 process definition for FlowDesk.
//
// This file is copied to /opt/flowdesk/ecosystem.config.cjs on the droplet and started
// with `pm2 start ecosystem.config.cjs`.
//
// The .cjs extension is deliberate: package.json sets "type": "module", so a .js file
// here is parsed as ESM and `module.exports` silently produces a config with no apps.
//
// SAFETY: the app name MUST stay `flowdesk`. The live upCarrera CRM runs on the same
// box as the PM2 app `upcarrera-api`. Never rename this to that, never restart that
// one, and never write outside /opt/flowdesk.

const fs = require('node:fs');
const path = require('node:path');

/**
 * Read /opt/flowdesk/.env into a plain object.
 *
 * PM2's own `env_file` option is NOT reliable here: on PM2 7.0.1 it is recorded in the
 * process metadata but its contents are never injected, so the app booted with only the
 * inline `env` values and the SSR server function failed with
 * "[Supabase] Missing Supabase environment variable(s)". Parsing the file ourselves is
 * version-proof, and it keeps the secrets in a chmod 600 file instead of in this
 * git-tracked config.
 */
function readEnvFile(file) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    // Missing .env is fatal in practice, but throwing here would break `pm2 list` and
    // every other command that loads this file. Fail at boot with a clear log instead.
    console.error(`[flowdesk] WARNING: ${file} not found — the app will start without Supabase credentials.`);
    return out;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const APP_DIR = '/opt/flowdesk';
const fileEnv = readEnvFile(path.join(APP_DIR, '.env'));

module.exports = {
  apps: [
    {
      name: 'flowdesk',
      cwd: '/opt/flowdesk',

      // The nitro node-server build entry. Produced by `bun run build` with the
      // node-server preset pinned in vite.config.ts. This is a plain Node script —
      // it is NOT a Cloudflare Workers bundle.
      script: '.output/server/index.mjs',

      // FlowDesk's OWN Node runtime, not the system one.
      //
      // The droplet ships Node 20, and the live upCarrera CRM runs on it — so it must
      // not be upgraded. But @supabase/supabase-js needs a global WebSocket, which only
      // exists from Node 22. Under Node 20 every server function failed with
      // "Node.js detected but native WebSocket not found", which surfaced as a
      // permanently empty Dashboard while every other screen looked fine.
      //
      // Giving FlowDesk its own interpreter fixes that and leaves /usr/bin/node — and
      // therefore the CRM — completely untouched. Install with:
      //   curl -fsSL https://nodejs.org/dist/v22.x.y/node-v22.x.y-linux-x64.tar.xz \
      //     | tar -xJ -C /opt/flowdesk/node --strip-components=1
      interpreter: '/opt/flowdesk/node/bin/node',

      // One fork. FlowDesk serves ~30-40 internal staff; clustering would add memory
      // pressure on a 4 GB box that is already running the CRM, for no real benefit.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',

      // Restart if the process leaks past 500 MB, so FlowDesk can never starve the CRM.
      max_memory_restart: '500M',

      // On a restart the email worker finishes the send in flight, puts the rest of its
      // batch back and exits on its own (about a second when idle). PM2's default 1.6 s
      // could cut that send off half-recorded, and it would go out again 15 min later.
      kill_timeout: 15000,

      // Runtime secrets come from /opt/flowdesk/.env (chmod 600), never from this
      // git-tracked file. The SSR server reads SUPABASE_URL and
      // SUPABASE_PUBLISHABLE_KEY from process.env at request time
      // (src/integrations/supabase/auth-middleware.ts), so they must be here or the
      // Dashboard renders empty.
      //
      // The literals below are last so they always win: nginx proxies to 3100 and the
      // process must stay on loopback, whatever the .env happens to say.
      //
      // Note VITE_* values are baked into the client bundle at BUILD time; setting them
      // here does nothing for the browser. Change one, and you must rebuild.
      env: {
        ...fileEnv,
        NODE_ENV: 'production',
        PORT: '3100',
        HOST: '127.0.0.1',
      },

      out_file: '/var/log/flowdesk/out.log',
      error_file: '/var/log/flowdesk/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
