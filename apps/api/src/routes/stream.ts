import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Store } from '../store/index.js';

export function streamRouter(store: Store): Hono {
  const r = new Hono();

  /**
   * SSE stream of packet/action events. Subscribes to the store, which fans
   * out events from local writes and from Postgres LISTEN/NOTIFY in
   * multi-replica deployments.
   */
  r.get('/', (c) =>
    streamSSE(c, async (s) => {
      const unsub = store.subscribe((event) => {
        s.writeSSE({ data: JSON.stringify(event), event: event.type });
      });

      const ping = setInterval(() => {
        s.writeSSE({ data: JSON.stringify({ type: 'ping' }), event: 'ping' });
      }, 15_000);

      await new Promise<void>((resolve) => {
        s.onAbort(() => {
          clearInterval(ping);
          unsub();
          resolve();
        });
      });
    }),
  );

  return r;
}
