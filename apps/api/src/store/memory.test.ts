import { describe, expect, it } from 'vitest';
import type { Packet, StreamEvent, UserAction } from '@jitsw/shared';
import { MemoryStore } from './memory.js';

function fakePacket(id: string): Packet {
  return {
    id,
    createdAt: new Date(2026, 4, 17, 0, parseInt(id.slice(-2), 36)).toISOString(),
    agent: { id: 'test', name: 'test', origin: 'custom' },
    kind: 'alert',
    title: `packet ${id}`,
    surface: {
      version: 'v0.8',
      messages: [
        { surfaceUpdate: { surfaceId: 'main', components: [] } },
        { beginRendering: { surfaceId: 'main', root: 'root' } },
      ],
    },
  };
}

function fakeAction(id: string, packetId: string): UserAction {
  return {
    id,
    packetId,
    timestamp: new Date().toISOString(),
    name: 'approve',
    surfaceId: 'main',
    sourceComponentId: 'approve',
  };
}

describe('MemoryStore', () => {
  it('stores and retrieves a packet', async () => {
    const store = new MemoryStore();
    const p = fakePacket('aa');
    await store.addPacket(p);
    expect(await store.getPacket('aa')).toEqual(p);
  });

  it('lists packets newest-first', async () => {
    const store = new MemoryStore();
    await store.addPacket(fakePacket('aa'));
    await store.addPacket(fakePacket('bb'));
    await store.addPacket(fakePacket('cc'));
    const list = await store.listPackets();
    expect(list.map((p) => p.id)).toEqual(['cc', 'bb', 'aa']);
  });

  it('respects the limit on listPackets', async () => {
    const store = new MemoryStore();
    for (const id of ['aa', 'bb', 'cc', 'dd']) await store.addPacket(fakePacket(id));
    const list = await store.listPackets({ limit: 2 });
    expect(list).toHaveLength(2);
  });

  it('returns undefined for an unknown packet', async () => {
    const store = new MemoryStore();
    expect(await store.getPacket('missing')).toBeUndefined();
  });

  it('records an action and lists by packet', async () => {
    const store = new MemoryStore();
    const p = fakePacket('aa');
    await store.addPacket(p);
    await store.addAction(fakeAction('act1', p.id));
    await store.addAction(fakeAction('act2', p.id));
    const acts = await store.listActions(p.id);
    expect(acts).toHaveLength(2);
    expect(acts.every((a) => a.packetId === p.id)).toBe(true);
  });

  it('broadcasts packet events to subscribers', async () => {
    const store = new MemoryStore();
    const seen: StreamEvent[] = [];
    const unsub = store.subscribe((e) => seen.push(e));
    const p = fakePacket('aa');
    await store.addPacket(p);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'packet', packet: { id: 'aa' } });
    unsub();
    await store.addPacket(fakePacket('bb'));
    expect(seen).toHaveLength(1); // unsubscribed, no further events
  });

  it('broadcasts action.status events', async () => {
    const store = new MemoryStore();
    const seen: StreamEvent[] = [];
    store.subscribe((e) => seen.push(e));
    await store.addAction(fakeAction('act1', 'p1'));
    expect(seen).toEqual([
      { type: 'action.status', status: { actionId: 'act1', ok: true } },
    ]);
  });

  it('isolates subscriber failures', async () => {
    const store = new MemoryStore();
    const good: StreamEvent[] = [];
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe((e) => good.push(e));
    await store.addPacket(fakePacket('aa'));
    expect(good).toHaveLength(1);
  });
});
