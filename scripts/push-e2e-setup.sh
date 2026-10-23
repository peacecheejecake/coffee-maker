#!/usr/bin/env bash
# Test keys and certificates for the push end-to-end test (packages/adapters/test/push.e2e.int.test.ts):
# a throwaway CA and a server certificate for the mock push service, VAPID keys, an APNs key and an FCM
# service-account key. Writes supabase/functions/.env.local (gitignored) for the local edge runtime.
#
#   scripts/push-e2e-setup.sh <dir>     # keys go to <dir>, outside the repo
#   set -a; source supabase/functions/.env.local; set +a; pnpm supabase stop; pnpm supabase start -x …
#   PUSH_E2E=1 PUSH_TLS_DIR=<dir> NOTIFY_SECRET=… pnpm test:int
#
# None of these keys can reach a real push service; production keys go into `supabase secrets set`.
set -euo pipefail
DIR=${1:?usage: scripts/push-e2e-setup.sh <dir>}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="$ROOT/supabase/functions/.env.local"
MOCK=https://host.docker.internal:9443
mkdir -p "$DIR"
cd "$DIR"

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 365 \
  -subj "/CN=coffee-maker push test CA" -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -subj "/CN=host.docker.internal" \
  -keyout key.pem -out server.csr 2>/dev/null
cat > ext.cnf <<'EOF'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:host.docker.internal,DNS:localhost,IP:127.0.0.1
EOF
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 365 -extfile ext.cnf -out cert.pem 2>/dev/null

openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out apns.p8
openssl pkey -in apns.p8 -pubout -out apns-pub.pem
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out fcm.pem 2>/dev/null
openssl pkey -in fcm.pem -pubout -out fcm-pub.pem

oneline() { awk '{printf "%s\\n", $0}' "$1"; }
vapid=$(npx -y web-push@3 generate-vapid-keys --json)
json() { node -e "process.stdout.write(JSON.parse(process.argv[1])[process.argv[2]])" "$vapid" "$1"; }

if [ -f "$ENV_FILE" ]; then cp "$ENV_FILE" "$ENV_FILE.bak"; fi
cat > "$ENV_FILE" <<EOF
NOTIFY_SECRET=$(openssl rand -hex 16)
VAPID_PUBLIC_KEY=$(json publicKey)
VAPID_PRIVATE_KEY=$(json privateKey)
VAPID_SUBJECT=mailto:dev@localhost
PUSH_TEST_CA=$(oneline ca.pem)
APNS_KEY_ID=TESTKEY1
APNS_TEAM_ID=TESTTEAM
APNS_PRIVATE_KEY=$(oneline apns.p8)
APNS_BUNDLE_ID=app.coffeemaker.underworld
APNS_ORIGIN=$MOCK
FCM_PROJECT_ID=coffee-test
FCM_CLIENT_EMAIL=push@coffee-test.iam.gserviceaccount.com
FCM_PRIVATE_KEY=$(oneline fcm.pem)
FCM_ORIGIN=$MOCK
FCM_TOKEN_URL=$MOCK/token
EOF
echo "keys in $DIR; wrote $ENV_FILE"
