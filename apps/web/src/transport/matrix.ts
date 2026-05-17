/**
 * Matrix transport — placeholder.
 *
 * The plan: agents post a custom event type `org.jitsw.a2ui.v1` to a Matrix
 * room. The PWA syncs that room via matrix-js-sdk and emits `Packet` events
 * mapped from those Matrix events. User actions become responses in the same
 * room (relations) so the agent can pick them up on its side.
 *
 * This is intentionally a stub; the HTTP transport is the v0 substrate.
 */
import type { Packet, StreamEvent, UserAction } from '@jitsw/shared';
import type { Transport } from './index';

export class MatrixTransport implements Transport {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_opts: { homeserverUrl: string; accessToken: string; roomId: string }) {
    throw new Error('MatrixTransport: not implemented yet');
  }

  listPackets(): Promise<Packet[]> {
    throw new Error('not implemented');
  }

  subscribe(_onEvent: (event: StreamEvent) => void): () => void {
    throw new Error('not implemented');
  }

  sendAction(_action: Omit<UserAction, 'id' | 'timestamp'>): Promise<UserAction> {
    throw new Error('not implemented');
  }
}
