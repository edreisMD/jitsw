/**
 * Postgres Store implementation.
 *
 * Realtime fanout uses Postgres LISTEN/NOTIFY so SSE works across multiple
 * API replicas: every writer NOTIFY's a channel; every reader LISTEN's and
 * forwards to its in-process subscribers.
 *
 * Migrations are managed by Drizzle Kit. Run `npm run db:migrate` to apply.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { desc, eq } from 'drizzle-orm';
import pg from 'pg';
import type { Packet, UserAction, StreamEvent } from '@jitsw/shared';
import type { Store, Subscriber } from './index.js';
import { packets, actions, type PacketRow } from './schema.js';

const NOTIFY_CHANNEL = 'jitsw_events';

export class PostgresStore implements Store {
  private pool: pg.Pool;
  private db: NodePgDatabase;
  private subscribers = new Set<Subscriber>();
  private listenClient?: pg.Client;
  private listenReady?: Promise<void>;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool);
    this.listenReady = this.startListener(databaseUrl).catch((err) => {
      console.error('[postgres] LISTEN failed, realtime degraded', err);
    });
  }

  async addPacket(packet: Packet): Promise<void> {
    await this.db
      .insert(packets)
      .values({
        id: packet.id,
        createdAt: new Date(packet.createdAt),
        expiresAt: packet.expiresAt ? new Date(packet.expiresAt) : null,
        agent: packet.agent,
        kind: packet.kind,
        title: packet.title,
        summary: packet.summary ?? null,
        surface: packet.surface,
        hints: packet.hints ?? null,
        gbrainCitations: packet.gbrainCitations ?? null,
        matrixRoomId: null,
      })
      .onConflictDoNothing();

    await this.notify({ type: 'packet', packet });
  }

  async listPackets(opts: { limit?: number } = {}): Promise<Packet[]> {
    const limit = opts.limit ?? 200;
    const rows = await this.db
      .select()
      .from(packets)
      .orderBy(desc(packets.createdAt))
      .limit(limit);
    return rows.map(rowToPacket);
  }

  async getPacket(id: string): Promise<Packet | undefined> {
    const [row] = await this.db
      .select()
      .from(packets)
      .where(eq(packets.id, id))
      .limit(1);
    return row ? rowToPacket(row) : undefined;
  }

  async addAction(action: UserAction): Promise<void> {
    await this.db
      .insert(actions)
      .values({
        id: action.id,
        packetId: action.packetId,
        timestamp: new Date(action.timestamp),
        name: action.name,
        surfaceId: action.surfaceId,
        sourceComponentId: action.sourceComponentId,
        context: action.context ?? null,
      })
      .onConflictDoNothing();

    await this.notify({
      type: 'action.status',
      status: { actionId: action.id, ok: true },
    });
  }

  async listActions(packetId: string): Promise<UserAction[]> {
    const rows = await this.db
      .select()
      .from(actions)
      .where(eq(actions.packetId, packetId))
      .orderBy(actions.timestamp);
    return rows.map((r) => ({
      id: r.id,
      packetId: r.packetId,
      timestamp: r.timestamp.toISOString(),
      name: r.name,
      surfaceId: r.surfaceId,
      sourceComponentId: r.sourceComponentId,
      context: r.context ?? undefined,
    }));
  }

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  async close(): Promise<void> {
    try {
      await this.listenClient?.end();
    } catch (err) {
      console.warn('[postgres] error closing listen client', err);
    }
    await this.pool.end();
  }

  // ---- internals -----------------------------------------------------------

  private async startListener(databaseUrl: string): Promise<void> {
    // A dedicated single connection for LISTEN — pooled connections can't
    // hold session-bound state.
    this.listenClient = new pg.Client({ connectionString: databaseUrl });
    await this.listenClient.connect();
    await this.listenClient.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this.listenClient.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const event = JSON.parse(msg.payload) as StreamEvent;
        for (const fn of this.subscribers) fn(event);
      } catch (err) {
        console.warn('[postgres] bad NOTIFY payload', err);
      }
    });
    this.listenClient.on('error', (err) => {
      console.error('[postgres] LISTEN client error', err);
    });
  }

  private async notify(event: StreamEvent): Promise<void> {
    // Use the pool, not the dedicated listen client — NOTIFY is safe to
    // multiplex. JSON-encode and quote it for Postgres.
    const payload = JSON.stringify(event).replace(/'/g, "''");
    await this.pool.query(`NOTIFY ${NOTIFY_CHANNEL}, '${payload}'`);
  }
}

function rowToPacket(row: PacketRow): Packet {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString(),
    agent: row.agent,
    kind: row.kind as Packet['kind'],
    title: row.title,
    summary: row.summary ?? undefined,
    surface: row.surface,
    hints: row.hints ?? undefined,
    gbrainCitations: row.gbrainCitations ?? undefined,
  };
}
