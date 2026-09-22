#!/usr/bin/env bash
#
# Provision self-hosted Supabase on a FRESH DigitalOcean droplet.
#
#   scp deploy/supabase/bootstrap.sh root@<NEW_IP>:/root/
#   scp supabase.env               root@<NEW_IP>:/root/          # from gen-secrets.mjs
#   ssh root@<NEW_IP> 'bash /root/bootstrap.sh <NEW_IP>'
#
# THIS MUST RUN ON THE NEW DROPLET ONLY.
# It installs Docker and 13 containers. Never run it on 168.144.188.190 — that
# box runs the live upCarrera CRM and FlowDesk, and this would fight them for
# memory and for ports 80/443.
set -euo pipefail

DROPLET_IP="${1:?usage: bootstrap.sh <this-droplet-public-ip>}"
SB_HOST="supabase.${DROPLET_IP//./-}.sslip.io"
SB_REF="1e444589c6ba54c6b6dc43ecf6bb3a39e4f55566"
STACK_DIR=/opt/supabase

echo "==> Supabase will be published at https://${SB_HOST}"

if [ "$DROPLET_IP" = "168.144.188.190" ]; then
  echo "REFUSING: that is the CRM + FlowDesk droplet. Use a NEW droplet." >&2
  exit 1
fi

echo "==> Checking resources"
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_MB" -lt 3500 ]; then
  echo "REFUSING: ${TOTAL_MB}MB RAM. The Supabase stack is 13 containers and needs 4GB+." >&2
  exit 1
fi
echo "    ${TOTAL_MB}MB RAM, $(nproc) vCPU, $(df -h / | awk 'NR==2{print $4}') free disk"

echo "==> Installing Docker, nginx, certbot"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git nginx certbot python3-certbot-nginx apache2-utils jq >/dev/null
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
docker --version && docker compose version

echo "==> Fetching the Supabase stack, pinned to ${SB_REF}"
rm -rf /tmp/supabase-src
git clone -q --filter=blob:none --no-checkout https://github.com/supabase/supabase /tmp/supabase-src
cd /tmp/supabase-src
git sparse-checkout init --cone >/dev/null
git sparse-checkout set docker >/dev/null
git checkout -q "${SB_REF}"
mkdir -p "${STACK_DIR}"
cp -R /tmp/supabase-src/docker/. "${STACK_DIR}/"
cd "${STACK_DIR}"

echo "==> Applying configuration"
[ -f /root/supabase.env ] || { echo "MISSING /root/supabase.env — run gen-secrets.mjs first" >&2; exit 1; }
# Start from the stack's own .env.example so no key the compose file expects is
# missing, then override with ours.
cp .env.example .env
python3 - <<'PY'
import re
ours = {}
for line in open('/root/supabase.env'):
    line = line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    k, v = line.split('=', 1)
    ours[k.strip()] = v.strip()
out, seen = [], set()
for line in open('/opt/supabase/.env'):
    m = re.match(r'^([A-Z_][A-Z0-9_]*)=', line)
    if m and m.group(1) in ours:
        k = m.group(1); out.append(f"{k}={ours[k]}\n"); seen.add(k)
    else:
        out.append(line)
extra = [f"{k}={v}\n" for k, v in ours.items() if k not in seen]
if extra:
    out.append("\n# Added by bootstrap.sh\n"); out.extend(extra)
open('/opt/supabase/.env','w').writelines(out)
print(f"  merged {len(ours)} values, {len(extra)} new")
PY
chmod 600 "${STACK_DIR}/.env"

echo "==> Starting the stack (first pull takes a few minutes)"
docker compose pull -q
docker compose up -d
sleep 45
docker compose ps

echo "==> nginx + TLS for ${SB_HOST}"
cat > /etc/nginx/sites-available/supabase.conf <<NGINX
# Self-hosted Supabase for FlowDesk. Terminates TLS and proxies to the stack's
# API gateway. The FlowDesk browser bundle calls this directly, so CORS and
# websockets both have to work.
upstream supabase_gw { server 127.0.0.1:8000; keepalive 16; }

server {
    listen 80;
    listen [::]:80;
    server_name SB_HOST_TOKEN;

    client_max_body_size 50m;
    server_tokens off;

    # Studio is the full admin UI — never expose it unauthenticated.
    location /studio/ {
        auth_basic "FlowDesk Supabase";
        auth_basic_user_file /etc/nginx/.supabase_htpasswd;
        proxy_pass http://supabase_gw;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://supabase_gw;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
NGINX
sed -i "s|${SB_HOST_PLACEHOLDER:-SB_HOST_TOKEN}|${SB_HOST}|" /etc/nginx/sites-available/supabase.conf

DASH_USER=$(grep -E '^DASHBOARD_USERNAME=' "${STACK_DIR}/.env" | cut -d= -f2-)
DASH_PASS=$(grep -E '^DASHBOARD_PASSWORD=' "${STACK_DIR}/.env" | cut -d= -f2-)
htpasswd -bc /etc/nginx/.supabase_htpasswd "${DASH_USER}" "${DASH_PASS}" >/dev/null
chmod 640 /etc/nginx/.supabase_htpasswd

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/supabase.conf /etc/nginx/sites-enabled/supabase.conf
nginx -t
systemctl reload nginx

echo "==> Requesting a certificate for ${SB_HOST}"
CERTBOT_EMAIL=$(grep -E '^SMTP_ADMIN_EMAIL=' "${STACK_DIR}/.env" | cut -d= -f2-)
certbot --nginx -d "${SB_HOST}" --non-interactive --agree-tos \
  --email "${CERTBOT_EMAIL:-admin@upcarrera.com}" --redirect

echo "==> Firewall: only 22/80/443 from outside. Postgres stays internal."
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status numbered

echo
echo "=========================================================="
echo " Supabase is up at https://${SB_HOST}"
echo " Studio:            https://${SB_HOST}/studio/  (basic auth)"
echo " Stack dir:         ${STACK_DIR}"
echo " Config (chmod 600): ${STACK_DIR}/.env"
echo
echo " Next: apply the FlowDesk migrations, then import the data."
echo "=========================================================="
