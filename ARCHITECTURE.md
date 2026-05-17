# JITSW Architecture

> The mobile A2UI client for agent-native teams. This document explains how the pieces fit together so contributors and operators can change one part without breaking the others.

## 30-second view

```
       agent (OpenClaw / Hermes / Claude Code / Codex / custom)
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   ┌────▼─────┐         ┌────────▼────────┐         ┌─────▼──────┐
   │ @jitsw/  │         │  Matrix room    │         │ MCP server │
   │   sdk    │         │ org.jitsw.a2ui  │         │ stdio/HTTP │
   └────┬─────┘         └────────┬────────┘         └─────┬──────┘
        │ HTTP POST              │ matrix-js-sdk          │ stdio
        ▼                        ▼                        ▼
              ┌──────────────────────────────────┐
              │           JITSW API              │
              │  Hono + Drizzle + Postgres + SSE │
              └─────────────┬────────────────────┘
                            │ store.subscribe()
              ┌─────────────┴────────────────────┐
              │                                  │
        ┌─────▼──────┐                  ┌────────▼────────┐
        │  PWA (SSE) │                  │  GBrain sync    │
        │ @a2ui/lit  │                  │  put_page / fact│
        └────────────┘                  └─────────────────┘
```

## Core ideas

### 1. The packet is the unit of work

A `Packet` (see `packages/shared/src/index.ts`) is one agent → user message containing an A2UI surface plus metadata (kind, title, summary, citations, hints). An action is one user → agent reply.

Everything else in the system — Matrix events, GBrain pages, push notifications, audit logs — derives from these two record types. Adding new ingress paths or new sinks doesn't require new record types.

### 2. A2UI is the wire format, not a JITSW invention

[A2UI](https://a2ui.org) is Google's open declarative UI protocol, published under Apache-2.0 as `@a2ui/lit`. JITSW renders A2UI v0.8 today because OpenClaw's Canvas does. v0.9 is a one-line swap when OpenClaw adopts it.

Agents emit standard A2UI. JITSW renders standard A2UI. The only JITSW-specific layer is the small wrapper that decides _why_ to render it (kind, title, citations) — see `Packet`.

### 3. Ingress is pluggable

Three ways an agent gets a packet into JITSW:

- **HTTP**: `POST /packets` with the JSON body. Used by `@jitsw/sdk`. Simplest.
- **Matrix**: a Matrix message of type `m.room.message` whose content carries `com.jitsw.a2ui`. The JITSW API runs `matrix-js-sdk` (`apps/api/src/matrix-bridge.ts`) and converts those events into packets. Used by OpenClaw via its native Matrix channel.
- **MCP**: agents call tools `jitsw_push_surface`, `jitsw_wait_action`, `jitsw_send_alert`, `jitsw_get_actions` over stdio MCP (`packages/plugin-openclaw/src/mcp.ts`). The MCP server is a thin wrapper around the HTTP path. Used by Claude Code / Codex / OpenClaw bundle-plugin loaders.

All three lead to the same `store.addPacket()` call. There is no preferred path; mix and match.

### 4. Realtime is the store's job

The store interface (`apps/api/src/store/index.ts`) owns both persistence and fanout. In memory, fanout is in-process. In Postgres, fanout is LISTEN/NOTIFY on the `jitsw_events` channel — so SSE works across replicas without an external pub/sub.

If we ever outgrow LISTEN/NOTIFY (Postgres NOTIFY has an 8KB payload limit), Pub/Sub slides in here without changing routes or the PWA.

### 5. GBrain is a sink, not a dependency

Every packet → `artifacts/jitsw/<id>.md`. Every action → `decisions/jitsw/<id>.md`. The pages carry frontmatter so a future GBrain query can reconstruct the decision graph.

If GBrain isn't running, JITSW still works — the sync subsystem is opt-in via `GBRAIN_HTTP_URL`. Same shape as the Matrix bridge: optional subsystem that subscribes to the store.

## Layout

```
jitsw-app/
├── apps/
│   ├── web/                    Vite + React PWA, mobile-first
│   │   └── src/
│   │       ├── App.tsx         Routes EmptyState ↔ Feed
│   │       ├── routes/
│   │       │   ├── EmptyState  #FDFDFC + "build something" + command chips
│   │       │   └── Feed        TikTok-style snap-scroll of A2UI surfaces
│   │       ├── a2ui/           @a2ui/lit renderer wrapper
│   │       ├── transport/      HTTP today; Matrix stub for self-host later
│   │       └── lib/commands.ts GBrain/GStack command palette data
│   └── api/                    Hono on Node 20+, Cloud Run shape
│       └── src/
│           ├── server.ts       Entry: builds store + routes + subsystems
│           ├── routes/         packets, actions, stream (SSE)
│           ├── store/          Interface + memory + postgres + schema
│           ├── matrix-bridge.ts  Optional Matrix ingress
│           └── gbrain.ts       Optional GBrain sink
├── packages/
│   ├── shared/                 Types — the contract every package depends on
│   ├── sdk/                    @jitsw/sdk agent client (push/wait/decide)
│   └── plugin-openclaw/        MCP server + openclaw.plugin.json manifest
├── infra/
│   ├── openclaw/jitsw-ui/      SKILL.md — instructs OpenClaw to emit A2UI
│   └── ngrok/                  Tunnel config for phone testing
├── migrations/                 SQL, applied by tsx src/store/migrate.ts
├── docker-compose.yml          Local Postgres (+ optional Synapse)
└── scripts/wire-openclaw.sh    One-shot wire OpenClaw → JITSW → GBrain
```

## Data shapes

```ts
type Packet = {
  id: string;
  createdAt: ISO8601;
  expiresAt?: ISO8601;
  agent: { id: string; name: string; origin: 'openclaw' | ... };
  kind: 'approval' | 'alert' | 'generated_ui' | 'status' | 'question';
  title: string;
  summary?: string;
  surface: { version: 'v0.8' | 'v0.9'; messages: unknown[] }; // A2UI
  hints?: { riskLevel?: 'low' | 'medium' | 'high'; reversible?: boolean };
  gbrainCitations?: { source: string; slug: string; excerpt?: string }[];
};

type UserAction = {
  id: string;
  packetId: string;
  timestamp: ISO8601;
  name: string;          // e.g. "approve"
  surfaceId: string;
  sourceComponentId: string;
  context?: Record<string, unknown>;
};
```

These shapes live in `@jitsw/shared` and are imported by every other package. Breaking changes here require coordinated changes everywhere.

## Matrix conventions

JITSW follows OpenClaw's pattern (`com.openclaw.approval` as a custom content key on `m.room.message`):

```jsonc
{
  "msgtype": "m.notice",
  "body": "Approve generated UI",     // fallback text for stock clients
  "com.jitsw.a2ui": {
    "kind": "approval",
    "title": "Approve generated UI",
    "summary": "Three risky changes",
    "version": "v0.8",
    "messages": [ /* A2UI v0.8 messages */ ]
  }
}
```

User actions come back the other direction:

```jsonc
{
  "msgtype": "m.notice",
  "body": "Action: approve",
  "com.jitsw.a2ui.action": {
    "id": "...",
    "packetId": "...",
    "name": "approve",
    "context": { ... }
  }
}
```

A separate event subtype, `com.jitsw.command`, carries gbrain/gstack command taps from the PWA to the agent. The agent interprets the command id and replies with the appropriate A2UI surface.

## Deployment shapes

### Local (zero ops)

In-memory store, no Matrix, no GBrain. Two processes:

```bash
npm run dev:api   # in-memory, :8787
npm run dev:web   # PWA, :5173
```

### Local with Postgres

```bash
docker compose up -d postgres
echo "DATABASE_URL=postgres://jitsw:jitsw@localhost:5433/jitsw" > .env
npm run db:migrate
npm run dev
```

### Local with full agent loop

See `TESTING.md`. Runs Synapse + GBrain + OpenClaw + JITSW + ngrok.

### Cloud Run (production target)

The API is a stateless Hono process. Drop it on Cloud Run, point `DATABASE_URL` at Cloud SQL Postgres. SSE works on Cloud Run (it streams HTTP responses). FCM handles mobile push; the PWA is served from Firebase Hosting or App Hosting.

That deploy template is in `infra/gcp/` (TBD — contribution welcome).

## What's deliberately not here yet

- **Auth.** API is currently open. The plan is a small `auth` interface in `@jitsw/shared` with adapters for Firebase Auth (hosted) and signed-JWT-from-Matrix (self-host). Don't ship to a public URL without this.
- **E2EE.** Matrix supports it; we don't enable it in the demo. Real deployments should.
- **Push notifications.** The PWA receives SSE today. Real phones need FCM web push.
- **Device pairing.** The PWA assumes one device. QR pairing for multi-device is on the roadmap.
- **Sandboxing of generated_ui bundles.** A2UI surfaces are safe (declarative). If we ever accept arbitrary HTML bundles, they must run in iframe + CSP sandbox.

Each of those is a focused PR, not a rewrite.
