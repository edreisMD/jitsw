# Security Policy

JITSW is the surface between AI agents and humans. Vulnerabilities here can leak agent-level secrets, forge approvals, or push arbitrary UI to someone's phone. We take that seriously.

## Reporting a vulnerability

**Please do not open a public GitHub issue.**

Email the maintainers at `security@<TBD>` (or open a private security advisory on GitHub if the repo is hosted there). Include:

- The vulnerable component (API route, PWA renderer, MCP tool, etc.).
- Reproduction steps and a minimal proof-of-concept.
- Suggested fix, if you have one.

We aim to acknowledge within 72 hours and to ship a fix or mitigation within 14 days for high-severity issues. We'll credit you in the release notes unless you'd rather stay anonymous.

## Trust boundaries

JITSW has four trust boundaries that operators need to understand:

1. **Agent → JITSW API.** Today the API is unauthenticated. Anyone who can reach `POST /packets` can push a card to every connected client. Run JITSW behind auth before exposing it. The auth interface lives in `@jitsw/shared` — adapters for Firebase Auth and Matrix-derived JWTs are planned.
2. **JITSW API → User device.** SSE is plain-text. If you don't terminate TLS at the edge, agents can be impersonated and decisions can be intercepted. Always serve JITSW over HTTPS.
3. **Matrix room membership.** Anyone in the Matrix room can post events. The bridge does not (yet) verify the sender's role. Don't put untrusted users in agent rooms.
4. **A2UI rendering.** A2UI v0.8 is declarative — it cannot execute arbitrary JavaScript. If a future packet kind ever ships raw HTML bundles (`generated_ui` with `bundle_url`), that surface MUST run in a sandboxed iframe with `sandbox="allow-scripts"` (no `allow-same-origin`) and a strict CSP. The renderer in `apps/web/src/a2ui/SurfaceHost.tsx` only accepts A2UI; do not bypass this.

## What we explicitly do NOT promise yet

- **End-to-end encryption.** Matrix supports it; JITSW doesn't enable it in the demo. Real deployments should turn it on (`encryption: true` in the channel config).
- **Multi-tenant isolation.** The current API has one global packet log. Per-tenant separation requires the auth layer.
- **Supply chain attestation.** We pin direct dependencies but don't yet sign releases or publish provenance.
- **Sandboxing of `generated_ui`.** Not implemented today because we only accept A2UI. See the trust boundary note above.

If any of these matter for your deployment, file an issue (or, better, a PR).

## Known-OK behaviors that look suspicious

- **The API logs full packet bodies at debug level.** Useful for development. Disable in production by setting `LOG_LEVEL=info`.
- **The in-memory store loses data on restart.** This is by design for `DATABASE_URL=` (unset). Use Postgres for any real deployment.
- **The Matrix bridge auto-joins every invite.** This is convenient for the demo but a small risk surface. Tighten to an allowlist (`autoJoin: "allowlist"`) for production.

## Dependencies

We track CVEs via `npm audit` in CI. High-severity issues block merges. Moderate issues open a tracking issue.
