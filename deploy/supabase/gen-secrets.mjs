#!/usr/bin/env node
/**
 * Generate every secret the self-hosted Supabase stack needs.
 *
 * Supabase's legacy API keys are just HS256 JWTs signed with JWT_SECRET, with a
 * `role` claim of `anon` or `service_role`. There is no service that mints them
 * for you when self-hosting, so we sign them here with node's crypto — no
 * dependencies, nothing leaves the machine.
 *
 * Usage:
 *   node gen-secrets.mjs > supabase.env      # then EDIT the URL vars
 *
 * The output is secret. It never belongs in git.
 */
import { createHmac, randomBytes } from 'node:crypto';

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Sign a Supabase-style HS256 API key. */
function signKey(role, secret, years = 10) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + years * 365 * 24 * 60 * 60;
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ role, iss: 'supabase', iat, exp }));
  const body = `${header}.${payload}`;
  const sig = createHmac('sha256', secret).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${body}.${sig}`;
}

// Alphanumeric only: these values travel through docker-compose, shell and URLs,
// and a stray '$' or '/' in a password is a long debugging session.
const pw = (n) => randomBytes(n * 2).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, n);

const JWT_SECRET = pw(64);
const host = process.argv[2] || 'supabase.CHANGE-ME.sslip.io';
const flowdeskHost = process.argv[3] || 'flowdesk.168-144-188-190.sslip.io';

console.log(`# Generated ${new Date().toISOString()} — SECRET, never commit.
# Supabase self-hosted configuration for FlowDesk.
#
# Public endpoint of this Supabase instance. The FlowDesk browser bundle talks
# to it directly, so it must be a real HTTPS hostname, not localhost.
SUPABASE_PUBLIC_URL=https://${host}
API_EXTERNAL_URL=https://${host}
SITE_URL=https://${flowdeskHost}
ADDITIONAL_REDIRECT_URLS=https://${flowdeskHost}/auth

POSTGRES_PASSWORD=${pw(48)}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${signKey('anon', JWT_SECRET)}
SERVICE_ROLE_KEY=${signKey('service_role', JWT_SECRET)}

# Studio (the admin UI) sits behind basic auth in nginx as well as this.
DASHBOARD_USERNAME=flowdesk
DASHBOARD_PASSWORD=${pw(32)}

SECRET_KEY_BASE=${pw(64)}
VAULT_ENC_KEY=${pw(32)}
REALTIME_DB_ENC_KEY=${pw(32)}
PG_META_CRYPTO_KEY=${pw(32)}
LOGFLARE_PUBLIC_ACCESS_TOKEN=${pw(32)}
LOGFLARE_PRIVATE_ACCESS_TOKEN=${pw(32)}
MINIO_ROOT_USER=flowdeskstorage
MINIO_ROOT_PASSWORD=${pw(32)}

POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432
JWT_EXPIRY=3600

# Internal-tool posture: no public sign-up. Accounts are created by an admin.
DISABLE_SIGNUP=true
ENABLE_EMAIL_SIGNUP=true
ENABLE_EMAIL_AUTOCONFIRM=false
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false

# SMTP — required for password recovery (the OTP flow in src/routes/auth.tsx).
# Until these are set, recovery codes are generated but never delivered.
# See deploy/supabase/README.md for the Microsoft 365 options.
SMTP_ADMIN_EMAIL=hello@upcarrera.com
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=FlowDesk
MAILER_URLPATHS_CONFIRMATION=/auth
MAILER_URLPATHS_INVITE=/auth
MAILER_URLPATHS_RECOVERY=/auth
MAILER_URLPATHS_EMAIL_CHANGE=/auth

STUDIO_DEFAULT_ORGANIZATION=upCarrera
STUDIO_DEFAULT_PROJECT=FlowDesk
REGION=local
FUNCTIONS_VERIFY_JWT=false
PGRST_DB_SCHEMAS=public,storage,graphql_public
POOLER_TENANT_ID=flowdesk
POOLER_DEFAULT_POOL_SIZE=15
POOLER_MAX_CLIENT_CONN=100
POOLER_DB_POOL_SIZE=5
POOLER_PROXY_PORT_TRANSACTION=6543
API_GW_HTTP_PORT=8000
KONG_HTTP_PORT=8000
KONG_HTTPS_PORT=8443
DOCKER_SOCKET_LOCATION=/var/run/docker.sock
IMGPROXY_AUTO_WEBP=true
`);

console.error(`
Generated. Next:
  1. Save as supabase.env on the new droplet (chmod 600).
  2. Replace the host in SUPABASE_PUBLIC_URL / API_EXTERNAL_URL if it is not:
       ${host}
  3. FlowDesk needs these two, and they are baked in at BUILD time:
       VITE_SUPABASE_URL=https://${host}
       VITE_SUPABASE_PUBLISHABLE_KEY=<the ANON_KEY above>
`);
