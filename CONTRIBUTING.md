# Contributing to JITSW

JITSW is built to be maintained — small, typed, modular, and boring where it counts. We welcome contributions that keep it that way.

## Quick start for contributors

```bash
git clone https://github.com/<your-fork>/jitsw
cd jitsw
npm install
docker compose up -d postgres
cp .env.example .env
npm run db:migrate --workspace apps/api
npm run dev            # api on :8787, pwa on :5173
npm test --workspace apps/api
```

If something doesn't work, that's a bug — open an issue.

## What we love in PRs

- **Small.** One change per PR. Easier to review, easier to revert.
- **Typed.** No `any` without a comment explaining why. We run `npm run typecheck` in CI.
- **Tested.** Anything that's worth merging is worth a smoke test. Vitest is set up.
- **Documented.** If you add a new subsystem, add a paragraph to `ARCHITECTURE.md`. If you add a new env var, update `.env.example`.
- **Boring.** Prefer established libraries (Hono, Drizzle, Vitest) over clever ones. JITSW should still build in three years.

## What we'll push back on

- Vendor lock-in. Anything specific to one cloud provider goes behind an interface with a swap path. Today: store, transport, auth, sync. Tomorrow: push.
- Custom protocols where standards exist. We use A2UI for UI, MCP for agent tools, Matrix for transport. Adding a fourth needs a strong reason.
- Big PRs that touch many layers at once.
- New deps without justification. Check the existing `package.json` first — there's a 90% chance you don't need a new library.

## Project layout

See `ARCHITECTURE.md` for the full layout. The short version:

- `apps/api`: the Hono backend. Postgres or in-memory. Subscribes to optional Matrix + GBrain subsystems.
- `apps/web`: the PWA. Vite + React + `@a2ui/lit`. Mobile-first.
- `packages/shared`: data types. Importing this is fine; anything else in `packages/*` should be importable only by its consumers.
- `packages/sdk`: agent-side client. Stays runtime-agnostic (works in Node, Bun, Deno, browser).
- `packages/plugin-openclaw`: MCP server + OpenClaw bundle manifest.
- `infra/`: openclaw skill, ngrok config, future GCP templates.

## Running tests

```bash
npm run typecheck          # all workspaces
npm test --workspace apps/api
npm run build --workspace apps/web
```

Add tests next to the code they test (`memory.test.ts` next to `memory.ts`). Vitest config is in `apps/api/vitest.config.ts`.

## Style

- **TypeScript strict.** `tsconfig.base.json` enables it; new files inherit.
- **ESM only.** No CommonJS in new code.
- **Comments where they help.** Explain _why_, not _what_. The "what" is in the code.
- **No emojis in code or commits** unless asked.

## Commit style

Conventional-ish:

```
feat(api): add Postgres LISTEN/NOTIFY fanout
fix(web): handle missing surface gracefully
docs: explain Matrix event keys
test(api): cover action broadcast
chore: bump matrix-js-sdk
```

One change per commit. Keep history readable.

## Reporting bugs

Open an issue with:
- What you ran (`npm run dev:api`)
- What you saw (full error)
- What you expected
- Versions (Node, npm, OS, OpenClaw, GBrain if relevant)

For security issues, see `SECURITY.md` — don't open a public issue.

## License

By contributing, you agree your contribution is licensed under Apache-2.0 (see `LICENSE`).
