#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${ROOT}/backend"
MATRIX_DIR="${ROOT}/matrix-local"
RUN_DIR="${BACKEND_DIR}/.run"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
JITSW_PORT="${JITSW_PORT:-80}"
JITSW_LOCAL_URL="${JITSW_LOCAL_URL:-http://localhost:${JITSW_PORT}}"
JITSW_PUBLIC_URL="${JITSW_PUBLIC_URL:-https://jitsw.ngrok.io}"
MATRIX_HOMESERVER_URL="${MATRIX_HOMESERVER_URL:-http://localhost:8008}"
MATRIX_SERVER_NAME="${MATRIX_SERVER_NAME:-localhost}"
MATRIX_HUMAN_USER="${MATRIX_HUMAN_USER:-jitsw-human}"
MATRIX_HUMAN_PASSWORD="${MATRIX_HUMAN_PASSWORD:-jitsw-demo-human-2}"
MATRIX_BOT_USER="${MATRIX_BOT_USER:-openclaw-bot}"
MATRIX_BOT_PASSWORD="${MATRIX_BOT_PASSWORD:-jitsw-demo-bot}"
GBRAIN_URL="${GBRAIN_URL:-http://localhost:3131}"
OPENCLAW_REFRESH_PLUGIN_CACHE="${OPENCLAW_REFRESH_PLUGIN_CACHE:-true}"

mkdir -p "$RUN_DIR"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[jitsw] missing required command: $1" >&2
    exit 1
  fi
}

json_get() {
  node -e 'let data = ""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => { const path = process.argv[1].split("."); let value = JSON.parse(data); for (const key of path) value = value?.[key]; if (value == null) process.exit(1); process.stdout.write(String(value)); });' "$1"
}

wait_http() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 80); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[jitsw] ${label} ready"
      return 0
    fi
    sleep 1
  done
  echo "[jitsw] timed out waiting for ${label}: ${url}" >&2
  return 1
}

start_jitsw_backend() {
  if curl -fsS "${JITSW_LOCAL_URL}/api/status" >/dev/null 2>&1; then
    echo "[jitsw] backend already running at ${JITSW_LOCAL_URL}"
    return 0
  fi

  if lsof -tiTCP:"${JITSW_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[jitsw] port ${JITSW_PORT} is already in use but not serving JITSW" >&2
    echo "[jitsw] set JITSW_PORT to another port or stop the process using it" >&2
    exit 1
  fi

  echo "[jitsw] starting backend at ${JITSW_LOCAL_URL}"
  env \
    JITSW_PORT="$JITSW_PORT" \
    MATRIX_HOMESERVER_URL="$MATRIX_HOMESERVER_URL" \
    MATRIX_HUMAN_USER="$MATRIX_HUMAN_USER" \
    MATRIX_HUMAN_PASSWORD="$MATRIX_HUMAN_PASSWORD" \
    MATRIX_USER="$MATRIX_BOT_USER" \
    MATRIX_PASSWORD="$MATRIX_BOT_PASSWORD" \
    "$BUN_BIN" run "${BACKEND_DIR}/server.ts" >"${RUN_DIR}/jitsw-backend-${JITSW_PORT}.log" 2>&1 &
  echo "$!" >"${RUN_DIR}/jitsw-backend-${JITSW_PORT}.pid"
  wait_http "${JITSW_LOCAL_URL}/api/status" "JITSW backend"
}

start_gbrain_if_available() {
  if curl -fsS "${GBRAIN_URL}/admin" >/dev/null 2>&1 || curl -fsS "${GBRAIN_URL}/mcp" >/dev/null 2>&1; then
    echo "[jitsw] GBrain already running at ${GBRAIN_URL}"
    return 0
  fi

  if ! command -v gbrain >/dev/null 2>&1; then
    echo "[jitsw] gbrain CLI not found; skipping GBrain server start"
    return 0
  fi

  echo "[jitsw] starting GBrain HTTP server at ${GBRAIN_URL}"
  gbrain serve --http --port 3131 >"${RUN_DIR}/gbrain.log" 2>&1 &
  echo "$!" >"${RUN_DIR}/gbrain.pid"
  wait_http "${GBRAIN_URL}/admin" "GBrain admin" || true
}

configure_openclaw_matrix() {
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "[jitsw] openclaw CLI not found; skipping OpenClaw Matrix configuration"
    return 0
  fi

  echo "[jitsw] ensuring JITSW Matrix room exists"
  curl -fsS "${JITSW_LOCAL_URL}/api/messages" >/dev/null
  local status_json room_id
  status_json="$(curl -fsS "${JITSW_LOCAL_URL}/api/status")"
  room_id="$(printf '%s' "$status_json" | json_get room.id)"

  echo "[jitsw] logging Matrix bot in for OpenClaw token"
  local bot_login bot_token bot_user_id human_id
  bot_login="$(curl -fsS -X POST "${MATRIX_HOMESERVER_URL}/_matrix/client/v3/login" \
    -H 'Content-Type: application/json' \
    --data "{\"type\":\"m.login.password\",\"identifier\":{\"type\":\"m.id.user\",\"user\":\"${MATRIX_BOT_USER}\"},\"password\":\"${MATRIX_BOT_PASSWORD}\"}")"
  bot_token="$(printf '%s' "$bot_login" | json_get access_token)"
  bot_user_id="@${MATRIX_BOT_USER}:${MATRIX_SERVER_NAME}"
  human_id="@${MATRIX_HUMAN_USER}:${MATRIX_SERVER_NAME}"

  local system_prompt batch_json
  system_prompt="You are GBrain - OpenClaw inside JITSW, the GBrain hackathon communication layer. Matrix is the durable company-owned channel and JITSW is the phone-first UI renderer. Treat this channel as UI-only: do not answer with prose, chat text, markdown explanation, status narration, or a text fallback. Communicate with the human only by sending a complete A2UI v0.9 JSON surface in a fenced json block. Use only components the JITSW renderer supports today: Column, Row, Card, Text, and Button. Every response must render as a functional full-screen mobile UI. For review flows include Approve, Request changes, and Reject buttons. Surface GBrain, GStack, and OpenClaw commands as explicit buttons when useful. If you need to ask a question, ask it as a UI surface with answer buttons. Keep surfaces phone-first, concise, and demo-friendly."

  batch_json="$(SYSTEM_PROMPT="$system_prompt" ROOM_ID="$room_id" BOT_USER_ID="$bot_user_id" BOT_TOKEN="$bot_token" HUMAN_ID="$human_id" MATRIX_HOMESERVER_URL="$MATRIX_HOMESERVER_URL" node <<'NODE'
const roomId = process.env.ROOM_ID;
const humanId = process.env.HUMAN_ID;
const matrix = {
  enabled: true,
  homeserver: process.env.MATRIX_HOMESERVER_URL,
  network: { dangerouslyAllowPrivateNetwork: true },
  userId: process.env.BOT_USER_ID,
  accessToken: process.env.BOT_TOKEN,
  autoJoin: "off",
  groupPolicy: "allowlist",
  groupAllowFrom: [humanId],
  dm: { policy: "allowlist", allowFrom: [humanId] },
  groups: {
    [roomId]: { enabled: true, requireMention: false, allowBots: false, users: [humanId], systemPrompt: process.env.SYSTEM_PROMPT },
  },
  rooms: {
    [roomId]: { enabled: true, requireMention: false, allowBots: false, users: [humanId], systemPrompt: process.env.SYSTEM_PROMPT },
  },
  streaming: "off",
  markdown: { tables: "bullets" },
  responsePrefix: "",
};
process.stdout.write(JSON.stringify([
  { path: "channels.matrix", value: matrix },
  { path: "plugins.entries.matrix.enabled", value: true },
  { path: "channels.discord.enabled", value: false },
  { path: "plugins.entries.bonjour.enabled", value: false },
]));
NODE
)"

  echo "[jitsw] writing OpenClaw Matrix channel config for room ${room_id}"
  openclaw config set --batch-json "$batch_json" >/dev/null

  if [ "$OPENCLAW_REFRESH_PLUGIN_CACHE" = "true" ]; then
    echo "[jitsw] restarting OpenClaw gateway and refreshing generated plugin cache"
    openclaw gateway stop >/dev/null 2>&1 || true
    local cache_backup="$HOME/.openclaw/plugin-runtime-deps-backups/jitsw-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$cache_backup"
    for dir in "$HOME"/.openclaw/plugin-runtime-deps/openclaw-*; do
      [ -e "$dir" ] && mv "$dir" "$cache_backup"/
    done
  else
    echo "[jitsw] restarting OpenClaw gateway"
    openclaw gateway stop >/dev/null 2>&1 || true
  fi

  openclaw gateway start >/dev/null || true
  sleep 25
  openclaw channels status --probe --json >/dev/null || true
}

require_cmd curl
require_cmd docker
require_cmd node
if [ ! -x "$BUN_BIN" ]; then
  echo "[jitsw] Bun not found at ${BUN_BIN}; set BUN_BIN or install Bun" >&2
  exit 1
fi

echo "[jitsw] starting Matrix"
env \
  MATRIX_SERVER_NAME="$MATRIX_SERVER_NAME" \
  MATRIX_HOMESERVER_URL="$MATRIX_HOMESERVER_URL" \
  MATRIX_HUMAN_USER="$MATRIX_HUMAN_USER" \
  MATRIX_HUMAN_PASSWORD="$MATRIX_HUMAN_PASSWORD" \
  MATRIX_BOT_USER="$MATRIX_BOT_USER" \
  MATRIX_BOT_PASSWORD="$MATRIX_BOT_PASSWORD" \
  "${MATRIX_DIR}/scripts/bootstrap.sh"

start_gbrain_if_available
start_jitsw_backend
configure_openclaw_matrix

cat <<EOF

[jitsw] demo stack is wired
  JITSW local:  ${JITSW_LOCAL_URL}
  JITSW public: ${JITSW_PUBLIC_URL}
  Matrix:       ${MATRIX_HOMESERVER_URL}
  GBrain:       ${GBRAIN_URL}/admin
  OpenClaw:     Matrix channel configured for @${MATRIX_HUMAN_USER}:${MATRIX_SERVER_NAME}

Try:
  curl -sS -X POST ${JITSW_LOCAL_URL}/api/chat \\
    -H 'Content-Type: application/json' \\
    --data '{"message":"Create a tiny A2UI approval surface for the JITSW demo. Do not send prose outside the UI JSON."}'

EOF
