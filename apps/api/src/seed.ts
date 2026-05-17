/**
 * Run with: `npx tsx src/seed.ts` (after `npm run dev` in apps/api)
 *
 * Seeds a few example packets so you can see the feed render without wiring
 * an agent. The A2UI messages here follow v0.8 surfaceUpdate + beginRendering.
 */

const BASE = process.env.JITSW_BASE_URL ?? 'http://localhost:8787';

const helloSurface = {
  version: 'v0.8' as const,
  messages: [
    {
      surfaceUpdate: {
        surfaceId: 'main',
        components: [
          {
            id: 'root',
            component: { Column: { children: { explicitList: ['title', 'body'] } } },
          },
          {
            id: 'title',
            component: {
              Text: {
                text: { literalString: 'Hello from JITSW' },
                usageHint: 'h2',
              },
            },
          },
          {
            id: 'body',
            component: {
              Text: {
                text: {
                  literalString:
                    'This card was rendered from an A2UI v0.8 envelope.',
                },
                usageHint: 'body',
              },
            },
          },
        ],
      },
    },
    { beginRendering: { surfaceId: 'main', root: 'root' } },
  ],
};

async function main() {
  const res = await fetch(`${BASE}/packets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      agent: {
        id: 'seed.example',
        name: 'seed',
        origin: 'custom',
      },
      kind: 'generated_ui',
      title: 'Welcome to JITSW',
      summary: "Seeded card. Real agents push packets via @jitsw/sdk.",
      surface: helloSurface,
    }),
  });
  console.log(res.status, await res.text());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
