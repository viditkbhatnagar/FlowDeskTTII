#!/usr/bin/env bash
#
# Create the droplet that will run self-hosted Supabase.
#
#   export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_...
#   bash deploy/supabase/provision.sh [size] [region]
#
# Defaults to s-4vcpu-8gb in blr1. The Supabase stack is 13 containers; 8GB is
# comfortable, 4GB is the floor and leaves little room for Postgres cache.
#
# This creates a SEPARATE droplet. It never touches 168.144.188.190, which runs
# the live upCarrera CRM and FlowDesk.
set -euo pipefail

SIZE="${1:-s-4vcpu-8gb}"
REGION="${2:-blr1}"
NAME="${DROPLET_NAME:-flowdesk-supabase}"
IMAGE="ubuntu-24-04-x64"

command -v doctl >/dev/null || { echo "doctl not installed: brew install doctl" >&2; exit 1; }
: "${DIGITALOCEAN_ACCESS_TOKEN:?export DIGITALOCEAN_ACCESS_TOKEN=dop_v1_... first}"

echo "==> Authenticating"
doctl account get --format Email,Status --no-header

if doctl compute droplet list --format Name --no-header | grep -qx "$NAME"; then
  echo "Droplet '$NAME' already exists:"
  doctl compute droplet list "$NAME" --format ID,Name,PublicIPv4,Memory,Status
  exit 0
fi

echo "==> SSH keys on this account"
doctl compute ssh-key list --format ID,Name,FingerPrint --no-header
KEY_IDS=$(doctl compute ssh-key list --format ID --no-header | paste -sd, -)
[ -n "$KEY_IDS" ] || { echo "No SSH keys on the account. Add one first, or you cannot log in." >&2; exit 1; }

echo "==> Price check"
doctl compute size list --format Slug,Memory,VCPUs,PriceMonthly --no-header | awk -v s="$SIZE" '$1==s {printf "    %s: %s MB RAM, %s vCPU, $%s/mo\n", $1, $2, $3, $4}'

echo "==> Creating droplet '$NAME' ($SIZE, $REGION)"
doctl compute droplet create "$NAME" \
  --image "$IMAGE" --size "$SIZE" --region "$REGION" \
  --ssh-keys "$KEY_IDS" \
  --enable-monitoring --enable-backups \
  --tag-names flowdesk,supabase \
  --wait --format ID,Name,PublicIPv4,Memory,Status

IP=$(doctl compute droplet list "$NAME" --format PublicIPv4 --no-header | tr -d '[:space:]')
echo
echo "=========================================================="
echo " Droplet ready: $IP"
echo " Supabase will publish at: https://supabase.${IP//./-}.sslip.io"
echo
echo " Next:"
echo "   node deploy/supabase/gen-secrets.mjs supabase.${IP//./-}.sslip.io > supabase.env"
echo "   scp supabase.env deploy/supabase/bootstrap.sh root@$IP:/root/"
echo "   ssh root@$IP 'bash /root/bootstrap.sh $IP'"
echo "=========================================================="
