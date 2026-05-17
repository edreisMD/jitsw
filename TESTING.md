# Testing JITSW end-to-end

Goal: prove the loop **OpenClaw agent → Matrix → JITSW API → PWA on phone → action back through Matrix → OpenClaw → A2UI reply**.

There are four moving services:

| Service        | Port  | Started by                                       |
|----------------|-------|--------------------------------------------------|
| Synapse        | 8008  | `matrix-local/scripts/bootstrap.sh`              |
| GBrain HTTP    | 3131  | `gbrain serve --http --port 3131`                |
| OpenClaw       | 18789 | Already running on your Mac                      |
| JITSW API      | 8787  | `npm run dev:api` (from `jitsw-app/`)            |
| JITSW PWA      | 5173  | `npm run dev:web` (from `jitsw-app/`)            |
| ngrok          | —     | `ngrok start --config infra/ngrok/ngrok.yml --all` |

Local network setup so OpenClaw and the JITSW API can both reach the same Matrix room.

---

## 0. Preconditions (one-time)

```bash
brew install jq  # the setup script uses jq
echo "$NGROK_AUTHTOKEN"  # must be set, or set it with `ngrok config add-authtoken ...`
```

Confirm services are up:

```bash
curl -s http://localhost:8008/_matrix/client/versions | jq .versions[0]
# -> "r0.0.1" or similar
curl -s http://localhost:3131/health 2>/dev/null | head -3
# -> {"ok":true,...} or similar
pgrep -fl openclaw | head -3
# -> shows openclaw + openclaw-gateway
```

Install JITSW deps once:

```bash
cd ~/Documents/jitsw-app
npm install
```

---

## 1. Wire OpenClaw to Matrix + GBrain + JITSW skill

```bash
cd ~/Documents/jitsw-app
./scripts/wire-openclaw.sh
```

What it does:

1. Installs `@openclaw/matrix` plugin in OpenClaw.
2. Installs GBrain as an OpenClaw bundle plugin (reads `cloned_repos/gbrain/openclaw.plugin.json`).
3. Symlinks `infra/openclaw/jitsw-ui/SKILL.md` into `~/.openclaw/skills/jitsw-ui/`.
4. Logs into Matrix as `@jitsw-human:localhost` and `@openclaw-bot:localhost`.
5. Creates a new room "JITSW Demo" with both users, marks it with state event `com.jitsw.room: { enabled: true }`.
6. Patches `~/.openclaw/openclaw.json`:
   - Adds the matrix channel with `dangerouslyAllowPrivateNetwork: true`.
   - Adds a per-room `systemPrompt` + `skills: ["jitsw-ui"]` override so OpenClaw only emits A2UI in that room.
7. Prints the env vars you need to export for the JITSW API.

The script is idempotent — re-run it if you blow away the room.

After the script: restart OpenClaw so the new plugin + matrix channel load.

```bash
openclaw gateway restart
```

---

## 2. Start the JITSW API with the Matrix bridge

Copy the env vars from the wire-openclaw output. Then in `jitsw-app/`:

```bash
MATRIX_HOMESERVER_URL=http://localhost:8008 \
MATRIX_ACCESS_TOKEN=<HUMAN_TOKEN from wire-openclaw> \
MATRIX_USER_ID=@jitsw-human:localhost \
MATRIX_ROOMS=<ROOM_ID from wire-openclaw> \
npm run dev:api
```

You should see:

```
jitsw api listening on http://localhost:8787
[matrix] bridge syncing as @jitsw-human:localhost on http://localhost:8008
```

If the bridge log doesn't appear, the env vars didn't reach the process.

---

## 3. Start the PWA

In a second terminal:

```bash
cd ~/Documents/jitsw-app
npm run dev:web
```

Open `http://localhost:5173`. You should see:

- Background: warm paper `#FDFDFC`
- "build something" headline in muted grey
- "Spin up a GBrain agent" button
- `brain` chip row: Ask the brain, Recall recent, Save a note, …
- `stack` chip row: Ship, Review PR, Investigate, Office hours

---

## 4. Open the PWA from your phone

```bash
ngrok start --config infra/ngrok/ngrok.yml --all
```

ngrok prints two `https://<random>.ngrok-free.app` URLs — one for the PWA (`5173`), one for the API (`8787`). Open the web URL on your phone. On iOS, "Add to Home Screen" turns it into a standalone PWA with the right theme color.

The PWA in dev mode proxies `/api` to `http://localhost:8787`, which is on the dev machine. For the phone to reach the API too, the PWA tunnel URL needs to proxy through ngrok back to the dev box — that already happens because both tunnels point at the same machine.

---

## 5. Send the first message

In any Matrix client logged in as `@jitsw-human:localhost` (Element web works fine — point it at `http://localhost:8008`), open "JITSW Demo" and send:

> hi

OpenClaw, instructed by the jitsw-ui skill + per-room system prompt, should reply with a message whose content includes a `com.jitsw.a2ui` block. The JITSW API picks it up, converts it to a `Packet`, broadcasts on SSE, and the PWA renders the A2UI surface as a TikTok-style full-screen card.

If the reply is plain text instead of A2UI, OpenClaw didn't activate the skill. Re-check:

- `openclaw plugins list` — `@openclaw/matrix` enabled.
- `~/.openclaw/openclaw.json` — `channels.matrix.groups.<ROOM_ID>.skills` contains `"jitsw-ui"`.
- `~/.openclaw/skills/jitsw-ui/SKILL.md` exists (symlink is fine).
- OpenClaw gateway was restarted after the wire step.

---

## 6. Try a command

In the PWA, tap the **Ask the brain** chip. JITSW sends an action to the API → bridge sends an `m.room.message` with `com.jitsw.a2ui.action: { name: "ask", ... }` into the room → OpenClaw routes that to `gbrain.query` → replies with a `generated_ui` surface containing a TextField. Type a query in the TextField, submit, and another packet lands with the answer + citations.

---

## 7. Troubleshooting

| Symptom                                          | Likely cause                                                      |
|--------------------------------------------------|-------------------------------------------------------------------|
| API logs `bridge disabled`                       | env vars not set                                                  |
| API logs `M_FORBIDDEN` on join                   | bot didn't accept invite — `openclaw gateway restart`             |
| OpenClaw never replies in the room               | matrix plugin not enabled or `autoJoin` != `"always"`             |
| OpenClaw replies but PWA shows nothing           | bot replied without `com.jitsw.a2ui` — skill not active           |
| PWA loads but feed never updates                 | SSE blocked by Safari private-mode; try Chrome on phone           |
| ngrok rejects `--config`                         | your authtoken is unset — `ngrok config add-authtoken <token>`    |
| `[matrix] M_LIMIT_EXCEEDED`                      | rate limit during initial sync; wait 30s and retry                |

---

## What "wired correctly" looks like

```
[OpenClaw bot @openclaw-bot:localhost]
   │  (matrix-js-sdk via @openclaw/matrix plugin)
   ▼
[Synapse on localhost:8008]
   ▲
   │  (matrix-js-sdk via JITSW bridge)
[JITSW API on :8787] ── SSE ──▶ [PWA on :5173] ── via ngrok ──▶ [📱 phone]
   │
   └── tools/mcp ──▶ [GBrain on :3131]
```

The phone shows A2UI cards. Every tap on the phone becomes a Matrix event in the room. OpenClaw treats the room as canonical, replies with another A2UI card.
