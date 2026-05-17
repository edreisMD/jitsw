#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SYNAPSE_IMAGE="${SYNAPSE_IMAGE:-matrixdotorg/synapse:latest}"
SERVER_NAME="${MATRIX_SERVER_NAME:-localhost}"
HOMESERVER_URL="${MATRIX_HOMESERVER_URL:-http://localhost:8008}"
HUMAN_USER="${MATRIX_HUMAN_USER:-jitsw-human}"
HUMAN_PASSWORD="${MATRIX_HUMAN_PASSWORD:-jitsw-demo-human-2}"
BOT_USER="${MATRIX_BOT_USER:-openclaw-bot}"
BOT_PASSWORD="${MATRIX_BOT_PASSWORD:-jitsw-demo-bot}"

mkdir -p synapse-data

if [ ! -f synapse-data/homeserver.yaml ]; then
  echo "[jitsw] generating Synapse config for server_name=${SERVER_NAME}"
  docker run --rm \
    -v "$ROOT/synapse-data:/data" \
    -e SYNAPSE_SERVER_NAME="$SERVER_NAME" \
    -e SYNAPSE_REPORT_STATS=no \
    "$SYNAPSE_IMAGE" generate
fi

echo "[jitsw] starting Synapse"
docker compose up -d

echo "[jitsw] waiting for Synapse at ${HOMESERVER_URL}"
for _ in $(seq 1 60); do
  if curl -fsS "${HOMESERVER_URL}/_matrix/client/versions" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS "${HOMESERVER_URL}/_matrix/client/versions" >/dev/null

register_user() {
  local user="$1"
  local pass="$2"
  local admin_flag="$3"
  echo "[jitsw] ensuring Matrix user @${user}:${SERVER_NAME}"
  if docker compose exec -T synapse register_new_matrix_user \
    -c /data/homeserver.yaml \
    -u "$user" \
    -p "$pass" \
    "$admin_flag" \
    "${HOMESERVER_URL}" >/tmp/jitsw-register-user.log 2>&1; then
    return 0
  fi

  if grep -qi "already" /tmp/jitsw-register-user.log; then
    echo "[jitsw] user @${user}:${SERVER_NAME} already exists"
    return 0
  fi

  cat /tmp/jitsw-register-user.log >&2
  return 1
}

register_user "$HUMAN_USER" "$HUMAN_PASSWORD" "--admin"
register_user "$BOT_USER" "$BOT_PASSWORD" "--no-admin"

echo
echo "[jitsw] Matrix is ready"
echo "Homeserver: ${HOMESERVER_URL}"
echo "Human:     @${HUMAN_USER}:${SERVER_NAME} / ${HUMAN_PASSWORD}"
echo "Bot:       @${BOT_USER}:${SERVER_NAME} / ${BOT_PASSWORD}"
echo
echo "Get the bot token:"
echo "curl -sS -X POST ${HOMESERVER_URL}/_matrix/client/v3/login \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  --data '{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"${BOT_USER}\"},\"password\":\"${BOT_PASSWORD}\"}'"
