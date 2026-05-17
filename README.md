# JITSW

**Just-in-Time Software for GBrain + OpenClaw.**

JITSW is a mobile-first communication layer for AI-native teams. Instead of agents sending long chat replies into Slack, Discord, or Telegram, agents send complete A2UI surfaces that render as full-screen phone UI: approvals, generated interfaces, alerts, questions, and status cards.

For the GBrain hackathon, the demo is:

```
GBrain + OpenClaw agent
        |
      Matrix
        |
    JITSW API
        |
  JITSW mobile PWA
        |
 human approval/action
        |
 Matrix -> OpenClaw -> GBrain memory
```

The important product idea: company communication should be agent-native and owned by the company. Matrix is the open transport, A2UI is the UI protocol, GBrain is the memory layer, and OpenClaw is the agent runtime.

## What The Demo Shows

- A Slack-like company communication layer designed for agents first.
- A phone UI where agent work appears as full-screen interactive software, not a chat bubble.
- Native GBrain/GStack/OpenClaw command buttons so humans do not memorize slash commands.
- Matrix as the self-hostable company-owned transport.
- GBrain sync so artifacts and human decisions become company memory.

JITSW intentionally does **not** show the user's submitted messages in the app feed and does **not** render streaming text drafts. The phone only displays complete A2UI packets that are ready to use.

## Repo Layout

```
apps/web                    Vite + React PWA, TikTok-style A2UI feed
apps/api                    Hono API, packet store, SSE, Matrix bridge, GBrain sync
packages/shared             Shared Packet, Action, A2UI, auth types
packages/sdk                Agent-side HTTP SDK
packages/plugin-openclaw    MCP server + OpenClaw plugin manifest
infra/openclaw/jitsw-ui     OpenClaw skill: always respond with A2UI
scripts/wire-openclaw.sh    Local Matrix + OpenClaw wiring script
examples/hackathon-live-demo Exact Bun + ngrok prototype used for the video
infra/gcp                   Cloud Run / Cloud SQL deployment scripts
```

## Fast Local Demo

Prereqs:

```bash
brew install jq
npm install
```

Start the local services:

```bash
docker compose up -d postgres
cp .env.example .env
npm run db:migrate --workspace apps/api
npm run dev
```

Open:

```text
http://localhost:5173
```

Push a seed A2UI packet:

```bash
npm run seed --workspace apps/api
```

You should see a full-screen generated UI card in the PWA.

## Matrix + GBrain + OpenClaw Demo

This is the hackathon path.

If you want the exact lightweight prototype used in the recorded demo, run:

```bash
cd examples/hackathon-live-demo/backend
bun run demo:gbrain-openclaw
```

Then open `https://jitsw.ngrok.io/?v=demo` and watch:

```bash
openclaw tui --agent main --session 'matrix:direct:@jitsw-human:localhost'
```

1. Start a Matrix homeserver.

If you already have the JITSW hackathon Synapse running on `localhost:8008`, keep using it. Otherwise run your preferred Synapse setup and create two users:

```text
@jitsw-human:localhost
@openclaw-bot:localhost
```

2. Start GBrain.

```bash
gbrain serve --http --port 3131
```

3. Wire OpenClaw to the Matrix room and install the JITSW UI skill.

```bash
MATRIX_HOMESERVER_URL=http://localhost:8008 \
MATRIX_HUMAN_USER=jitsw-human \
MATRIX_HUMAN_PASSWORD=jitsw-demo-human-2 \
MATRIX_BOT_USER=openclaw-bot \
MATRIX_BOT_PASSWORD=jitsw-demo-bot \
./scripts/wire-openclaw.sh
```

The script:

- creates a private JITSW Matrix room,
- installs/symlinks the `jitsw-ui` OpenClaw skill,
- patches `~/.openclaw/openclaw.json`,
- disables Matrix streaming previews,
- instructs OpenClaw to communicate only by A2UI surfaces,
- prints the env vars needed by the JITSW API.

Restart OpenClaw:

```bash
openclaw gateway restart
```

4. Start the JITSW API with the Matrix bridge.

Use the values printed by `wire-openclaw.sh`:

```bash
MATRIX_HOMESERVER_URL=http://localhost:8008 \
MATRIX_ACCESS_TOKEN=<HUMAN_TOKEN> \
MATRIX_USER_ID=@jitsw-human:localhost \
MATRIX_ROOMS=<ROOM_ID> \
GBRAIN_HTTP_URL=http://localhost:3131 \
npm run dev:api
```

5. Start the PWA.

```bash
npm run dev:web
```

6. Open the phone UI.

```bash
ngrok http 5173
```

Open the ngrok HTTPS URL on your phone. Add it to the Home Screen for the PWA demo.

## How OpenClaw Should Respond

In a JITSW Matrix room, OpenClaw should not answer with normal prose. It should send an `m.room.message` containing `com.jitsw.a2ui`:

```json
{
  "msgtype": "m.notice",
  "body": "JITSW UI packet",
  "com.jitsw.a2ui": {
    "kind": "approval",
    "title": "Approve generated UI",
    "summary": "Review the agent-built screen.",
    "version": "v0.8",
    "messages": [
      { "surfaceUpdate": { "surfaceId": "main", "components": [] } },
      { "beginRendering": { "surfaceId": "main", "root": "root" } }
    ]
  }
}
```

The `body` field is only a Matrix fallback. The JITSW app ignores plain text and renders only complete A2UI packets.

## GCP Path

For a hosted demo:

```bash
gcloud auth login
gcloud auth application-default login
export GCP_PROJECT=<your-project>
infra/gcp/bootstrap.sh
infra/gcp/deploy.sh
```

The intended production shape is:

- Firebase Hosting for `apps/web`
- Cloud Run for `apps/api`
- Cloud SQL Postgres for packets/actions
- Firebase Auth with Google sign-in
- Matrix homeserver either self-hosted or provided by the company
- GBrain HTTP/MCP endpoint for company memory

## Hackathon Video Script

1. Show the JITSW phone UI.
2. Send a task to GBrain - OpenClaw through Matrix.
3. OpenClaw replies with a full-screen A2UI approval or generated app surface.
4. Tap approve/request changes/reject on the phone.
5. Show the action landing back in Matrix/OpenClaw.
6. Explain that the artifact and decision are saved to GBrain so future agents can use the company memory.

## License

Apache-2.0. See [LICENSE](./LICENSE).
