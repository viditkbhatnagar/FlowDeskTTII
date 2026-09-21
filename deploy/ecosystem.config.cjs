// PM2 process definition for FlowDesk.
//
// This file is copied to /opt/flowdesk/ecosystem.config.js on the droplet and started
// with `pm2 start ecosystem.config.js`.
//
// SAFETY: the app name MUST stay `flowdesk`. The live upCarrera CRM runs on the same
// box as the PM2 app `upcarrera-api`. Never rename this to that, never restart that
// one, and never write outside /opt/flowdesk.
module.exports = {
  apps: [
    {
      name: 'flowdesk',
      cwd: '/opt/flowdesk',

      // The nitro node-server build entry. Produced by `bun run build` with the
      // node-server preset pinned in vite.config.ts. This is a plain Node script —
      // it is NOT a Cloudflare Workers bundle.
      script: '.output/server/index.mjs',

      // One fork. FlowDesk serves ~30-40 internal staff; clustering would add memory
      // pressure on a 4 GB box that is already running the CRM, for no real benefit.
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',

      // Restart if the process leaks past 500 MB, so FlowDesk can never starve the CRM.
      max_memory_restart: '500M',

      // Bind to loopback only. nginx is the only thing that should reach this port;
      // exposing 3100 publicly would bypass TLS.
      env: {
        NODE_ENV: 'production',
        PORT: '3100',
        HOST: '127.0.0.1',
      },

      // Runtime secrets live in /opt/flowdesk/.env (chmod 600), not in this file.
      // Note that VITE_* values are baked into the client bundle at BUILD time, so
      // changing them here has no effect on the browser bundle — you must rebuild.
      env_file: '/opt/flowdesk/.env',

      out_file: '/var/log/flowdesk/out.log',
      error_file: '/var/log/flowdesk/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
