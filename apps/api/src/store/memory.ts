/**
 * In-memory Store implementation.
 *
 * Used for:
 *   - tests (deterministic, zero-setup)
 *   - local dev when no Postgres is running
 *   - hackathon-style demos where persistence is not required
 *
 * Not safe across process restarts; not safe across replicas. Use Postgres
 * for anything real.
 */
import type { Packet, UserAction, StreamEvent } from '@jitsw/shared';
import type { Store, Subscriber } from './index.js';

export class MemoryStore implements Store {
  private packets = new Map<string, Packet>();
  private actions = new Map<string, UserAction>();
  private subscribers = new Set<Subscriber>();

  async addPacket(packet: Packet): Promise<void> {
    this.packets.set(packet.id, packet);
    this.broadcast({ type: 'packet', packet });
  }

  async listPackets(opts: { limit?: number } = {}): Promise<Packet[]> {
    const sorted = [...this.packets.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    return opts.limit ? sorted.slice(0, opts.limit) : sorted;
  }

  async getPacket(id: string): Promise<Packet | undefined> {
    return this.packets.get(id);
  }

  async addAction(action: UserAction): Promise<void> {
    this.actions.set(action.id, action);
    this.broadcast({
      type: 'action.status',
      status: { actionId: action.id, ok: true },
    });
  }

  async listActions(packetId: string): Promise<UserAction[]> {
    return [...this.actions.values()].filter((a) => a.packetId === packetId);
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private broadcast(event: StreamEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (err) {
        console.error('[memory-store] subscriber threw', err);
      }
    }
  }
}
