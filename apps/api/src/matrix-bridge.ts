/**
 * Matrix bridge.
 *
 * Listens to a Matrix homeserver as a user, watches one or more rooms for
 * messages whose content carries our custom A2UI key `com.jitsw.a2ui`, and
 * converts those into JITSW Packets pushed into the in-memory store. User
 * actions arriving on the JITSW API are echoed back into the same room as
 * Matrix messages with content key `com.jitsw.a2ui.action`.
 *
 * This is the OpenClaw <-> JITSW glue. OpenClaw (acting as bot) emits A2UI on
 * the same room; this bridge picks it up and the PWA renders it. Approvals
 * sent from the PWA fly back the other direction.
 *
 * Conventions:
 *   inbound  m.room.message + com.jitsw.a2ui    -> Packet
 *   outbound m.room.message + com.jitsw.a2ui.action -> UserAction echo
 *
 * The bot side of this contract is documented in the JITSW skill that lives in
 * infra/openclaw/jitsw-ui/SKILL.md.
 */
import sdk from 'matrix-js-sdk';
import { randomUUID } from 'node:crypto';
import type {
  A2UIEnvelope,
  AgentRef,
  Packet,
  PacketKind,
  UserAction,
} from '@jitsw/shared';
import type { Store } from './store/index.js';

const { createClient, MatrixEvent, RoomMemberEvent } = sdk;
type MatrixClientLike = ReturnType<typeof createClient>;

export interface MatrixBridgeOptions {
  homeserverUrl: string;
  accessToken: string;
  userId: string;
  /** Optional list of room IDs/aliases to watch. If empty, watches every joined room. */
  rooms?: string[];
  /** Where packets land. */
  store: Store;
}

/**
 * Shape of the JITSW custom content the bot is expected to attach to
 * `m.room.message` events. The text `body` remains a human-readable fallback
 * so that non-JITSW Matrix clients can still see something.
 *
 *   {
 *     "msgtype": "m.notice",
 *     "body": "Approval needed: review generated UI",
 *     "com.jitsw.a2ui": {
 *       "kind": "approval",
 *       "title": "Approve generated UI",
 *       "summary": "...",
 *       "version": "v0.8",
 *       "messages": [...A2UI v0.8 messages...]
 *     }
 *   }
 */
interface InboundA2UI {
  kind: PacketKind;
  title: string;
  summary?: string;
  version: 'v0.8' | 'v0.9';
  messages: unknown[];
  hints?: Packet['hints'];
}

export class MatrixBridge {
  private client: MatrixClientLike;
  private roomFilter: Set<string>;

  constructor(private readonly opts: MatrixBridgeOptions) {
    this.client = createClient({
      baseUrl: opts.homeserverUrl,
      accessToken: opts.accessToken,
      userId: opts.userId,
    });
    this.roomFilter = new Set(opts.rooms ?? []);
  }

  async start(): Promise<void> {
    // Accept invites from any user automatically — fine for hackathon demo,
    // tighten before real use.
    this.client.on(RoomMemberEvent.Membership, (event: unknown, member: unknown) => {
      const m = member as { membership: string; userId: string; roomId: string };
      if (m.membership === 'invite' && m.userId === this.opts.userId) {
        this.client.joinRoom(m.roomId).catch((err: unknown) => {
          console.warn('[matrix] failed to auto-join', m.roomId, err);
        });
      }
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.client.on('Room.timeline' as any, (event: unknown) => {
      try {
        this.onTimelineEvent(event as InstanceType<typeof MatrixEvent>);
      } catch (err) {
        console.error('[matrix] timeline handler error', err);
      }
    });

    await this.client.startClient({ initialSyncLimit: 20 });
    console.log(
      `[matrix] bridge syncing as ${this.opts.userId} on ${this.opts.homeserverUrl}`,
    );
  }

  /** Send a UserAction back to Matrix so the bot can react to it. */
  async sendAction(roomId: string, action: UserAction): Promise<void> {
    // Matrix allows arbitrary custom keys on m.room.message content, but the
    // SDK types don't model that. We send via the raw sendEvent path with a
    // cast so we can attach `com.jitsw.a2ui.action`.
    const content = {
      msgtype: 'm.notice',
      body: `Action: ${action.name}`,
      'com.jitsw.a2ui.action': action,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this.client as any).sendEvent(roomId, 'm.room.message', content);
  }

  private onTimelineEvent(event: InstanceType<typeof MatrixEvent>): void {
    if (event.getType() !== 'm.room.message') return;
    if (event.getSender() === this.opts.userId) return; // ignore our own echoes

    const roomId = event.getRoomId();
    if (!roomId) return;
    if (this.roomFilter.size > 0 && !this.roomFilter.has(roomId)) return;

    const content = event.getContent() as Record<string, unknown>;
    const a2ui = content['com.jitsw.a2ui'] as InboundA2UI | undefined;
    if (!a2ui || !Array.isArray(a2ui.messages)) return;

    const room = this.client.getRoom(roomId);
    const senderId = event.getSender() ?? 'unknown';
    const senderName =
      room?.getMember(senderId)?.name ?? senderId;

    const agent: AgentRef = {
      id: senderId,
      name: senderName,
      origin: 'openclaw',
    };

    const envelope: A2UIEnvelope = {
      version: a2ui.version ?? 'v0.8',
      messages: a2ui.messages,
    };

    const packet: Packet = {
      id: randomUUID(),
      createdAt: new Date(event.getTs()).toISOString(),
      agent,
      kind: a2ui.kind,
      title: a2ui.title,
      summary: a2ui.summary,
      surface: envelope,
      hints: a2ui.hints,
    };

    // Stash the originating Matrix room id on the packet so we can route
    // actions back later. Persisted via a sidecar map for the memory store;
    // the postgres store also gets it via the matrix_room_id column (see
    // schema.ts).
    packetToRoom.set(packet.id, roomId);
    this.opts.store.addPacket(packet).catch((err) => {
      console.error('[matrix] failed to persist packet', err);
    });
  }
}

/**
 * Sidecar map from packet id -> originating Matrix room id. Used for routing
 * action replies back to the originating room. Survives only in-process.
 * For multi-replica deployments, read `matrix_room_id` from the packet row.
 */
export const packetToRoom = new Map<string, string>();

/** Convenience: start the bridge from env vars if all four are present. */
export async function maybeStartFromEnv(store: Store): Promise<MatrixBridge | null> {
  const homeserverUrl = process.env.MATRIX_HOMESERVER_URL;
  const accessToken = process.env.MATRIX_ACCESS_TOKEN;
  const userId = process.env.MATRIX_USER_ID;
  if (!homeserverUrl || !accessToken || !userId) {
    console.log('[matrix] bridge disabled (set MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID to enable)');
    return null;
  }
  const rooms = process.env.MATRIX_ROOMS?.split(',').map((s) => s.trim()).filter(Boolean);
  const bridge = new MatrixBridge({ homeserverUrl, accessToken, userId, rooms, store });
  await bridge.start();
  return bridge;
}
