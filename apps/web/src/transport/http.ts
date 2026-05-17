import type { Packet, StreamEvent, UserAction } from '@jitsw/shared';
import type { Transport } from './index';

export interface HttpTransportOptions {
  /** Base URL for the JITSW API. Defaults to /api which is proxied in dev. */
  baseUrl?: string;
}

export class HttpTransport implements Transport {
  private readonly baseUrl: string;

  constructor(opts: HttpTransportOptions = {}) {
    this.baseUrl = opts.baseUrl ?? '/api';
  }

  async listPackets(): Promise<Packet[]> {
    const res = await fetch(`${this.baseUrl}/packets`);
    if (!res.ok) throw new Error(`listPackets ${res.status}`);
    return (await res.json()) as Packet[];
  }

  subscribe(onEvent: (event: StreamEvent) => void): () => void {
    const es = new EventSource(`${this.baseUrl}/stream`);
    const handler = (evt: MessageEvent) => {
      try {
        onEvent(JSON.parse(evt.data) as StreamEvent);
      } catch {
        // ignore malformed events
      }
    };
    for (const t of ['packet', 'action.status', 'ping'] as const) {
      es.addEventListener(t, handler as EventListener);
    }
    return () => es.close();
  }

  async sendAction(
    action: Omit<UserAction, 'id' | 'timestamp'>,
  ): Promise<UserAction> {
    const res = await fetch(`${this.baseUrl}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!res.ok) throw new Error(`sendAction ${res.status}`);
    return (await res.json()) as UserAction;
  }
}
