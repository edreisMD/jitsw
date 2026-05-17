/**
 * Store interface. All implementations (memory, postgres, future Firestore)
 * conform to this. The server picks an implementation at boot via env vars.
 *
 * Design intent:
 *   - The store is the source of truth for packets + actions.
 *   - It also owns realtime fanout (subscribe). This keeps "write a row" and
 *     "broadcast to clients" atomic, so we never lose an event.
 *   - In a multi-process deployment, the postgres store delegates fanout to
 *     LISTEN/NOTIFY so SSE works across replicas.
 */
import type { Packet, UserAction, StreamEvent } from '@jitsw/shared';

export type Subscriber = (event: StreamEvent) => void;

export interface Store {
  /** Persist a packet and broadcast to subscribers. */
  addPacket(packet: Packet): Promise<void>;
  /** Recent packets, newest first. */
  listPackets(opts?: { limit?: number }): Promise<Packet[]>;
  getPacket(id: string): Promise<Packet | undefined>;

  /** Persist an action and broadcast a status event. */
  addAction(action: UserAction): Promise<void>;
  listActions(packetId: string): Promise<UserAction[]>;

  /** Subscribe to realtime events. Returns an unsubscribe function. */
  subscribe(fn: Subscriber): () => void;

  /** Shutdown hook for graceful close (db pool, etc.). */
  close?(): Promise<void>;
}

/**
 * Choose a Store implementation based on env. Lazy-imports the postgres path
 * so the server starts even if `pg` isn't installed (e.g. in tests).
 */
export async function createStoreFromEnv(): Promise<Store> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const { MemoryStore } = await import('./memory.js');
    console.log('[store] using in-memory store (set DATABASE_URL for Postgres)');
    return new MemoryStore();
  }
  const { PostgresStore } = await import('./postgres.js');
  console.log('[store] using Postgres store');
  return new PostgresStore(databaseUrl);
}
