export * from './auth.js';

/**
 * Shared types for JITSW.
 *
 * The core idea: an agent pushes an A2UI surface (Google's open standard for
 * agent-emitted UI) wrapped in a JITSW envelope. A user interacts with the
 * surface in the PWA, producing an action that flows back through the same
 * envelope shape.
 *
 * A2UI itself is a sequence of messages: surfaceUpdate, beginRendering,
 * dataModelUpdate, deleteSurface, createSurface. JITSW transports them as
 * opaque payloads — we don't need to understand A2UI internals here.
 */

export type ISO8601 = string;
export type UUID = string;

/** Identity of the agent that produced a packet. */
export interface AgentRef {
  /** Stable identifier, e.g. "gbrain.cron.daily-report" or "openclaw.session.xyz". */
  id: string;
  /** Human-readable name shown to the user. */
  name: string;
  /** Optional avatar URL. */
  avatarUrl?: string;
  /** What runtime produced this packet (gbrain, openclaw, hermes, custom). */
  origin: 'gbrain' | 'openclaw' | 'hermes' | 'claude-code' | 'codex' | 'custom';
}

/**
 * A2UI message envelope. The `messages` array contains raw A2UI v0.8 messages
 * (surfaceUpdate, beginRendering, etc.). JITSW does not interpret them; the
 * renderer in apps/web hands them directly to @a2ui/lit.
 */
export interface A2UIEnvelope {
  version: 'v0.8' | 'v0.9';
  /** Opaque A2UI messages, passed through to @a2ui/lit. */
  messages: unknown[];
}

/**
 * Why JITSW is showing this to the user. Drives card style + sort priority.
 *
 *  - approval: agent wants a yes/no/edit decision.
 *  - alert: something happened that the user should know about.
 *  - generated_ui: agent built an interactive UI, no specific decision required.
 *  - status: progress/status update from a long-running task.
 *  - question: agent needs free-form input.
 */
export type PacketKind =
  | 'approval'
  | 'alert'
  | 'generated_ui'
  | 'status'
  | 'question';

/** A single packet from an agent to a user. The basic unit of JITSW. */
export interface Packet {
  id: UUID;
  createdAt: ISO8601;
  expiresAt?: ISO8601;

  agent: AgentRef;
  kind: PacketKind;

  /** Short title shown in the feed and in push notifications. */
  title: string;
  /** Optional plain-text summary, shown when A2UI isn't rendered yet. */
  summary?: string;

  /** The rendered surface. Always A2UI. */
  surface: A2UIEnvelope;

  /** Hints for the client. Risk level affects emphasis; reversible affects UX warnings. */
  hints?: {
    riskLevel?: 'low' | 'medium' | 'high';
    reversible?: boolean;
  };

  /**
   * Optional GBrain citations the agent used to produce this packet.
   * Surfaced in the card detail view.
   */
  gbrainCitations?: GBrainCitation[];
}

export interface GBrainCitation {
  source: string;
  slug: string;
  title?: string;
  excerpt?: string;
}

/**
 * An action the user performed on a packet's surface. Mirrors the shape
 * @a2ui/lit emits via its userAction event.
 */
export interface UserAction {
  id: UUID;
  packetId: UUID;
  timestamp: ISO8601;

  /** Name from the A2UI component (e.g. "approve", "submitForm"). */
  name: string;
  /** Surface inside the packet that emitted the action. */
  surfaceId: string;
  /** Component inside the surface that triggered the action. */
  sourceComponentId: string;
  /** Resolved data model state at the time of the action. */
  context?: Record<string, unknown>;
}

/** A status update on a user action, sent back to the client for UI feedback. */
export interface ActionStatus {
  actionId: UUID;
  ok: boolean;
  error?: string;
}

/** Server-sent event types emitted by the API stream endpoint. */
export type StreamEvent =
  | { type: 'packet'; packet: Packet }
  | { type: 'action.status'; status: ActionStatus }
  | { type: 'ping' };
