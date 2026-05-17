/**
 * Transport interface. The PWA shouldn't care whether packets arrive over
 * HTTP+SSE, Matrix, WebSocket, or carrier pigeon — it cares about the shape.
 *
 * For the hackathon we ship HTTP. Matrix slots in by implementing the same
 * interface against matrix-js-sdk events of type `org.jitsw.a2ui.v1`.
 */
import type { Packet, UserAction, StreamEvent } from '@jitsw/shared';

export interface Transport {
  /** Initial fetch of recent packets when the app opens. */
  listPackets(): Promise<Packet[]>;

  /** Subscribe to live events. Returns an unsubscribe function. */
  subscribe(onEvent: (event: StreamEvent) => void): () => void;

  /** Send a user action back to whoever is on the other end. */
  sendAction(action: Omit<UserAction, 'id' | 'timestamp'>): Promise<UserAction>;
}
