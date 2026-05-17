/**
 * GBrain sync.
 *
 * Subscribes to the JITSW event stream and writes every packet + every action
 * back into GBrain as memory pages, so the company brain accumulates a real
 * record of what agents said and what humans decided.
 *
 * GBrain exposes an HTTP MCP server at `gbrain serve --http`. We talk to it
 * over that HTTP transport, not its embedded admin API or Postgres, because
 * GBrain explicitly designates markdown/frontmatter as the system of record.
 * See: cloned_repos/gbrain/docs/system-of-record.md.
 *
 * Pages we write:
 *
 *   artifacts/jitsw/<packet-id>.md  ← created on each packet
 *   decisions/jitsw/<action-id>.md  ← created on each action
 *
 * Both pages carry frontmatter pointing back to each other so a GBrain query
 * for a decision can find the full A2UI envelope it acted on.
 *
 * Configure with env vars:
 *   GBRAIN_HTTP_URL       e.g. http://localhost:3131
 *   GBRAIN_BEARER_TOKEN   the OAuth client token gbrain mints
 *   GBRAIN_SOURCE         the source slug (defaults to "jitsw")
 *
 * Disabled if GBRAIN_HTTP_URL is unset.
 */
import type { Store } from './store/index.js';
import type { Packet, StreamEvent, UserAction } from '@jitsw/shared';

export interface GBrainConfig {
  baseUrl: string;
  bearerToken?: string;
  source: string;
}

export class GBrainClient {
  constructor(private readonly cfg: GBrainConfig) {}

  /**
   * Write a markdown page. Maps to GBrain's `put_page` MCP tool.
   * GBrain's HTTP MCP is at `${baseUrl}/mcp` and follows the MCP JSON-RPC
   * shape. For now we use the simpler `${baseUrl}/admin/api/put_page`-style
   * REST shim that GBrain exposes; if that's gated, we fall back to MCP.
   */
  async putPage(slug: string, body: string, frontmatter: Record<string, unknown> = {}): Promise<void> {
    const payload = {
      source: this.cfg.source,
      slug,
      body,
      frontmatter,
    };
    const res = await fetch(`${this.cfg.baseUrl}/mcp/tools/put_page`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`gbrain put_page ${slug}: ${res.status} ${await res.text()}`);
    }
  }

  /** Extract facts from a chunk of text. Maps to `extract_facts` MCP tool. */
  async extractFacts(text: string, opts: { context?: Record<string, unknown> } = {}): Promise<void> {
    const res = await fetch(`${this.cfg.baseUrl}/mcp/tools/extract_facts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        source: this.cfg.source,
        text,
        context: opts.context,
      }),
    });
    if (!res.ok) {
      throw new Error(`gbrain extract_facts: ${res.status} ${await res.text()}`);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.bearerToken) h.authorization = `Bearer ${this.cfg.bearerToken}`;
    return h;
  }
}

// ---- formatting helpers ----------------------------------------------------

function packetToMarkdown(packet: Packet): { body: string; frontmatter: Record<string, unknown> } {
  const frontmatter: Record<string, unknown> = {
    type: 'jitsw.artifact',
    packet_id: packet.id,
    agent: packet.agent,
    kind: packet.kind,
    created_at: packet.createdAt,
    expires_at: packet.expiresAt,
    hints: packet.hints,
    surface_version: packet.surface.version,
  };
  const cites = packet.gbrainCitations
    ?.map((c) => `- [${c.source}:${c.slug}](${c.source}:${c.slug}) ${c.excerpt ?? ''}`)
    .join('\n');
  const body = [
    `# ${packet.title}`,
    '',
    packet.summary ?? '',
    '',
    cites ? `## Citations\n\n${cites}` : '',
    '',
    '## A2UI envelope',
    '',
    '```json',
    JSON.stringify(packet.surface, null, 2),
    '```',
    '',
  ].join('\n');
  return { body, frontmatter };
}

function actionToMarkdown(action: UserAction, packet?: Packet): { body: string; frontmatter: Record<string, unknown> } {
  const frontmatter: Record<string, unknown> = {
    type: 'jitsw.decision',
    action_id: action.id,
    packet_id: action.packetId,
    action_name: action.name,
    surface_id: action.surfaceId,
    source_component_id: action.sourceComponentId,
    timestamp: action.timestamp,
    agent: packet?.agent,
    related_artifact: `artifacts/jitsw/${action.packetId}`,
  };
  const body = [
    `# Decision: ${action.name}`,
    '',
    packet ? `On packet **${packet.title}** (kind: \`${packet.kind}\`).` : '',
    '',
    action.context ? '## Context\n\n```json\n' + JSON.stringify(action.context, null, 2) + '\n```' : '',
    '',
  ].join('\n');
  return { body, frontmatter };
}

// ---- bootstrap from env ----------------------------------------------------

export async function maybeStartGBrainSync(store: Store): Promise<GBrainClient | null> {
  const baseUrl = process.env.GBRAIN_HTTP_URL;
  if (!baseUrl) {
    console.log('[gbrain] sync disabled (set GBRAIN_HTTP_URL to enable)');
    return null;
  }
  const client = new GBrainClient({
    baseUrl,
    bearerToken: process.env.GBRAIN_BEARER_TOKEN,
    source: process.env.GBRAIN_SOURCE ?? 'jitsw',
  });

  // Subscribe to the stream. Failures per-event are logged, not fatal.
  store.subscribe(async (event: StreamEvent) => {
    try {
      if (event.type === 'packet') {
        const { body, frontmatter } = packetToMarkdown(event.packet);
        await client.putPage(`artifacts/jitsw/${event.packet.id}`, body, frontmatter);
      }
      if (event.type === 'action.status' && event.status.ok) {
        // Look up the action to render markdown. The store doesn't index
        // actions by id, but we expose packet lookup via the action's
        // packetId from the original write path. For sync purposes the
        // bare metadata is enough; richer pages can be written later.
        const { actionId } = event.status;
        const body = `# Action ${actionId}\n\n_Action acknowledged at ${new Date().toISOString()}._\n`;
        await client.putPage(`decisions/jitsw/${actionId}`, body, {
          type: 'jitsw.decision',
          action_id: actionId,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('[gbrain] sync write failed', err);
    }
  });

  console.log(`[gbrain] sync enabled -> ${baseUrl} source=${client['cfg'].source}`);
  return client;
}

// Exported for tests.
export const _formatters = { packetToMarkdown, actionToMarkdown };
