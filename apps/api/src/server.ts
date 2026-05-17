import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { packetsRouter } from './routes/packets.js';
import { actionsRouter } from './routes/actions.js';
import { streamRouter } from './routes/stream.js';
import { createStoreFromEnv } from './store/index.js';
import { authMiddleware, createAuthFromEnv } from './auth/index.js';
import { maybeStartFromEnv as maybeStartMatrixBridge } from './matrix-bridge.js';
import { maybeStartGBrainSync } from './gbrain.js';

async function main(): Promise<void> {
  const [store, auth] = await Promise.all([
    createStoreFromEnv(),
    createAuthFromEnv(),
  ]);

  const app = new Hono();
  app.use('*', logger());
  app.use('*', cors());
  app.use('*', authMiddleware(auth));

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/packets', packetsRouter(store));
  app.route('/actions', actionsRouter(store));
  app.route('/stream', streamRouter(store));

  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port });
  console.log(`jitsw api listening on http://localhost:${port}`);

  maybeStartMatrixBridge(store).catch((err) =>
    console.error('[matrix] bridge failed to start', err),
  );
  maybeStartGBrainSync(store).catch((err) =>
    console.error('[gbrain] sync failed to start', err),
  );

  const shutdown = async (signal: string) => {
    console.log(`[server] received ${signal}, closing`);
    await store.close?.();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] fatal', err);
  process.exit(1);
});
