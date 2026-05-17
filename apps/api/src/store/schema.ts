/**
 * Drizzle schema for the JITSW Postgres store.
 *
 * The two core tables:
 *   - packets: every agent → user event we've seen
 *   - actions: every user → agent reply we've sent
 *
 * Both are append-only by design. JITSW doesn't update or delete; it adds new
 * rows. This makes the table a natural audit log + replay source, which is
 * useful for both debugging and the "feed GBrain" pipeline.
 *
 * We deliberately keep the schema lean. Anything richer (per-tenant rows,
 * device pairings, push tokens) lives in separate tables added later.
 */
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import type {
  Packet,
  UserAction,
  A2UIEnvelope,
  AgentRef,
  GBrainCitation,
} from '@jitsw/shared';

export const packets = pgTable(
  'packets',
  {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    agent: jsonb('agent').$type<AgentRef>().notNull(),
    kind: text('kind').notNull(),

    title: text('title').notNull(),
    summary: text('summary'),

    surface: jsonb('surface').$type<A2UIEnvelope>().notNull(),
    hints: jsonb('hints').$type<Packet['hints']>(),
    gbrainCitations: jsonb('gbrain_citations').$type<GBrainCitation[]>(),

    /**
     * Optional Matrix room id of origin. Lets us route action replies back to
     * the right room without a sidecar map.
     */
    matrixRoomId: text('matrix_room_id'),
  },
  (t) => ({
    byCreatedAt: index('packets_created_at_idx').on(t.createdAt),
    byAgent: index('packets_agent_idx').on(t.agent),
  }),
);

export const actions = pgTable(
  'actions',
  {
    id: text('id').primaryKey(),
    packetId: text('packet_id').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

    name: text('name').notNull(),
    surfaceId: text('surface_id').notNull(),
    sourceComponentId: text('source_component_id').notNull(),
    context: jsonb('context').$type<UserAction['context']>(),
  },
  (t) => ({
    byPacket: index('actions_packet_idx').on(t.packetId),
    byTimestamp: index('actions_timestamp_idx').on(t.timestamp),
  }),
);

export type PacketRow = typeof packets.$inferSelect;
export type ActionRow = typeof actions.$inferSelect;
