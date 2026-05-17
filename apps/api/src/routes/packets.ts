import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Packet } from '@jitsw/shared';
import type { Store } from '../store/index.js';

export function packetsRouter(store: Store): Hono {
  const r = new Hono();

  /** Agent pushes a new packet. The PWA receives it via the SSE stream. */
  r.post('/', async (c) => {
    const body = await c.req.json<Omit<Packet, 'id' | 'createdAt'>>();
    const packet: Packet = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...body,
    };
    await store.addPacket(packet);
    return c.json(packet, 201);
  });

  /** PWA fetches recent packets on first load. SSE covers updates after. */
  r.get('/', async (c) => {
    const limit = Number(c.req.query('limit') ?? '200');
    return c.json(await store.listPackets({ limit }));
  });

  r.get('/:id', async (c) => {
    const p = await store.getPacket(c.req.param('id'));
    if (!p) return c.json({ error: 'not_found' }, 404);
    return c.json(p);
  });

  return r;
}
