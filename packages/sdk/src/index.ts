/**
 * @jitsw/sdk — agent-side client for pushing A2UI surfaces to a user's phone.
 *
 * Designed to be runtime-agnostic: works in Node, Bun, Deno, the browser, or
 * inside an agent harness like Hermes/OpenClaw/Claude Code. The only platform
 * dependency is global `fetch`.
 *
 * Usage:
 *   const jitsw = new Jitsw({ baseUrl: "https://api.jitsw.dev", agent: {...} });
 *   await jitsw.push({
 *     kind: "approval",
 *     title: "Approve generated UI",
 *     surface: { version: "v0.8", messages: [...a2uiMessages] },
 *   });
 */
import type {
  A2UIEnvelope,
  AgentRef,
  Packet,
  PacketKind,
  UserAction,
} from '@jitsw/shared';

export interface JitswOptions {
  baseUrl: string;
  agent: AgentRef;
  /** Bearer token if the server requires auth. */
  token?: string;
}

export interface PushArgs {
  kind: PacketKind;
  title: string;
  summary?: string;
  surface: A2UIEnvelope;
  hints?: Packet['hints'];
  gbrainCitations?: Packet['gbrainCitations'];
  expiresAt?: string;
}

export class Jitsw {
  constructor(private readonly opts: JitswOptions) {}

  /** Push a new packet (an A2UI surface + metadata) to the user. */
  async push(args: PushArgs): Promise<Packet> {
    const res = await this.req('POST', '/packets', {
      agent: this.opts.agent,
      ...args,
    });
    return (await res.json()) as Packet;
  }

  /**
   * Block until the user takes an action on the given packet, or the timeout
   * elapses. Returns the first matching action.
   */
  async wait(packetId: string, timeoutMs = 5 * 60_000): Promise<UserAction | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await this.req('GET', `/actions/by-packet/${packetId}`);
      const actions = (await res.json()) as UserAction[];
      if (actions.length > 0) return actions[0]!;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.token) headers.authorization = `Bearer ${this.opts.token}`;
    const res = await fetch(this.opts.baseUrl + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`jitsw ${method} ${path} -> ${res.status}`);
    return res;
  }
}

export type { Packet, UserAction, A2UIEnvelope, AgentRef, PacketKind } from '@jitsw/shared';
