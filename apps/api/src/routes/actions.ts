import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { UserAction } from '@jitsw/shared';
import type { Store } from '../store/index.js';

export function actionsRouter(store: Store): Hono {
  const r = new Hono();

  /** PWA reports a user action on a packet's A2UI surface. */
  r.post('/', async (c) => {
    const body = await c.req.json<Omit<UserAction, 'id' | 'timestamp'>>();
    const action: UserAction = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...body,
    };
    await store.addAction(action);
    return c.json(action, 201);
  });

  r.get('/by-packet/:packetId', async (c) =>
    c.json(await store.listActions(c.req.param('packetId'))),
  );

  return r;
}
