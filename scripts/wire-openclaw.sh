#!/usr/bin/env bash
#
# wire-openclaw.sh — wire the local OpenClaw to local Synapse + GBrain + JITSW.
#
# Prereqs:
#   - Synapse running at localhost:8008 (run `matrix-local/scripts/bootstrap.sh`)
#   - GBrain running at localhost:3131 (`gbrain serve --http --port 3131`)
#   - OpenClaw installed (`openclaw` on PATH)
#
# What this does:
#   1. Installs the OpenClaw matrix plugin if missing.
#   2. Installs GBrain as an OpenClaw bundle plugin (mounts gbrain MCP).
#   3. Installs the JITSW UI skill into ~/.openclaw/skills/jitsw-ui.
#   4. Logs into Matrix as @jitsw-human:localhost and @openclaw-bot:localhost
#      to get access tokens.
#   5. Creates a JITSW DM room between them.
#   6. Writes the room id into ~/.openclaw/openclaw.json under
#      channels.matrix.groups so the per-room system prompt + skills load.
#   7. Prints the env vars to set when starting the JITSW API.
#
# Idempotent: safe to re-run.

set -euo pipefail

HOMESERVER_URL="${MATRIX_HOMESERVER_URL:-http://localhost:8008}"
HUMAN_USER="${MATRIX_HUMAN_USER:-jitsw-human}"
HUMAN_PASSWORD="${MATRIX_HUMAN_PASSWORD:-jitsw-demo-human-2}"
BOT_USER="${MATRIX_BOT_USER:-openclaw-bot}"
BOT_PASSWORD="${MATRIX_BOT_PASSWORD:-jitsw-demo-bot}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GBRAIN_REPO="${GBRAIN_REPO:-/Users/eduardo/Documents/jitsw/cloned_repos/gbrain}"

say() { printf '\033[1;34m[wire]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[wire]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[wire]\033[0m %s\n' "$*" >&2; exit 1; }

command -v openclaw >/dev/null || die "openclaw not on PATH"
command -v curl >/dev/null || die "curl not on PATH"
command -v jq >/dev/null || die "jq not on PATH (brew install jq)"

# ---- 1. Synapse reachable? ------------------------------------------------
say "checking Synapse at $HOMESERVER_URL"
curl -fsS "$HOMESERVER_URL/_matrix/client/versions" >/dev/null \
  || die "Synapse not reachable. Run matrix-local/scripts/bootstrap.sh first."

# ---- 2. Matrix logins -----------------------------------------------------
login() {
  local user="$1" pass="$2"
  curl -fsS -X POST "$HOMESERVER_URL/_matrix/client/v3/login" \
    -H 'Content-Type: application/json' \
    --data @<(jq -n --arg u "$user" --arg p "$pass" '{
      type: "m.login.password",
      identifier: { type: "m.id.user", user: $u },
      password: $p
    }')
}

say "logging in @${HUMAN_USER}:localhost"
HUMAN_LOGIN="$(login "$HUMAN_USER" "$HUMAN_PASSWORD")"
HUMAN_TOKEN="$(echo "$HUMAN_LOGIN" | jq -r .access_token)"
HUMAN_ID="$(echo "$HUMAN_LOGIN" | jq -r .user_id)"

say "logging in @${BOT_USER}:localhost"
BOT_LOGIN="$(login "$BOT_USER" "$BOT_PASSWORD")"
BOT_TOKEN="$(echo "$BOT_LOGIN" | jq -r .access_token)"
BOT_ID="$(echo "$BOT_LOGIN" | jq -r .user_id)"

# ---- 3. Create or reuse the JITSW room ------------------------------------
say "creating JITSW room (human invites bot)"
ROOM_JSON="$(curl -fsS -X POST \
  -H "Authorization: Bearer $HUMAN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg bot "$BOT_ID" '{
    preset: "private_chat",
    visibility: "private",
    invite: [$bot],
    is_direct: true,
    name: "JITSW Demo",
    initial_state: [
      { type: "com.jitsw.room", state_key: "", content: { enabled: true } }
    ]
  }')" \
  "$HOMESERVER_URL/_matrix/client/v3/createRoom")"
ROOM_ID="$(echo "$ROOM_JSON" | jq -r .room_id)"
say "room: $ROOM_ID"

# ---- 4. OpenClaw plugins --------------------------------------------------
say "installing OpenClaw matrix plugin (if missing)"
openclaw plugins install @openclaw/matrix >/dev/null 2>&1 || warn "matrix plugin install reported a non-zero status (likely already installed)"

if [ -d "$GBRAIN_REPO" ] && [ -f "$GBRAIN_REPO/openclaw.plugin.json" ]; then
  say "installing GBrain as OpenClaw bundle plugin from $GBRAIN_REPO"
  openclaw plugins install "$GBRAIN_REPO" >/dev/null 2>&1 \
    || warn "gbrain plugin install reported a non-zero status (likely already installed)"
else
  warn "GBrain repo not found at $GBRAIN_REPO; skipping plugin install"
fi

# ---- 5. Install JITSW UI skill -------------------------------------------
SKILL_SRC="$REPO_ROOT/infra/openclaw/jitsw-ui"
SKILL_DST="$HOME/.openclaw/skills/jitsw-ui"
say "installing jitsw-ui skill to $SKILL_DST"
mkdir -p "$(dirname "$SKILL_DST")"
ln -sfn "$SKILL_SRC" "$SKILL_DST"

# ---- 6. Patch openclaw.json with matrix channel + per-room override ------
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"
say "patching $OPENCLAW_JSON"
cp "$OPENCLAW_JSON" "$OPENCLAW_JSON.bak-jitsw-$(date +%s)"

jq --arg homeserver "$HOMESERVER_URL" \
   --arg userId "$BOT_ID" \
   --arg password "$BOT_PASSWORD" \
   --arg roomId "$ROOM_ID" \
   '
   .channels.matrix = {
     enabled: true,
     homeserver: $homeserver,
     userId: $userId,
     password: $password,
     deviceName: "JITSW Demo OpenClaw",
     network: { dangerouslyAllowPrivateNetwork: true },
     encryption: false,
     dm: { policy: "open" },
     groupPolicy: "open",
     autoJoin: "always",
     streaming: "off",
     groups: {
       ($roomId): {
         systemPrompt: "You are GBrain - OpenClaw inside JITSW. This Matrix room is UI-only: do not answer with prose, markdown explanation, or normal chat text. Every response must be a complete A2UI v0.8 surface wrapped in com.jitsw.a2ui using the jitsw-ui skill. Use the Matrix body only as a short fallback for non-JITSW clients. JITSW ignores plain text and renders only complete UI packets.",
         skills: ["jitsw-ui"]
       }
     }
   }' "$OPENCLAW_JSON" > "$OPENCLAW_JSON.tmp"
mv "$OPENCLAW_JSON.tmp" "$OPENCLAW_JSON"

# ---- 7. Restart hint and env vars for JITSW API --------------------------
cat <<EOF

\033[1;32m[wire] done\033[0m

Restart OpenClaw gateway to pick up matrix:

  openclaw gateway restart

Start the JITSW API with these env vars so the bridge syncs as the human:

  cd $REPO_ROOT
  MATRIX_HOMESERVER_URL=$HOMESERVER_URL \\
  MATRIX_ACCESS_TOKEN=$HUMAN_TOKEN \\
  MATRIX_USER_ID=$HUMAN_ID \\
  MATRIX_ROOMS=$ROOM_ID \\
  npm run dev:api

Then start the PWA:

  npm run dev:web

Test by saying anything to the bot in the room — OpenClaw should reply with
an A2UI surface that lands in the PWA feed.

JITSW room id: $ROOM_ID
Human user:    $HUMAN_ID   token: $HUMAN_TOKEN
Bot user:      $BOT_ID

EOF
