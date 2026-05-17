/**
 * JITSW MCP server.
 *
 * Exposes JITSW as MCP tools any compliant client (OpenClaw, Claude Code,
 * Codex, Cursor, custom Hermes, etc.) can call. The server speaks stdio MCP,
 * which is what OpenClaw bundle-plugins and Claude Code expect.
 *
 * Tools:
 *   jitsw_push_surface   Push an A2UI v0.8 surface to the user.
 *   jitsw_send_alert     Push a plain alert (no interactive surface).
 *   jitsw_wait_action    Block until the user interacts with a packet.
 *   jitsw_get_actions    List actions for a packet (non-blocking).
 *
 * Configure with env vars:
 *   JITSW_BASE_URL   HTTP base URL of the JITSW API (default http://localhost:8787)
 *   JITSW_AGENT_ID   Stable id of the calling agent
 *   JITSW_AGENT_NAME Human-readable name shown in the UI
 *   JITSW_TOKEN      Optional bearer token if the API is auth-gated
 *
 * Run via OpenClaw plugin manifest (see openclaw.plugin.json), or directly:
 *   JITSW_BASE_URL=http://localhost:8787 node dist/mcp.js
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Jitsw } from '@jitsw/sdk';
import type { AgentRef, PacketKind } from '@jitsw/shared';

const BASE_URL = process.env.JITSW_BASE_URL ?? 'http://localhost:8787';
const AGENT_ID = process.env.JITSW_AGENT_ID ?? 'mcp.unknown';
const AGENT_NAME = process.env.JITSW_AGENT_NAME ?? 'Agent';
const AGENT_ORIGIN = (process.env.JITSW_AGENT_ORIGIN ?? 'openclaw') as AgentRef['origin'];

const jitsw = new Jitsw({
  baseUrl: BASE_URL,
  agent: { id: AGENT_ID, name: AGENT_NAME, origin: AGENT_ORIGIN },
  token: process.env.JITSW_TOKEN,
});

const server = new McpServer(
  {
    name: 'jitsw',
    version: '0.0.1',
  },
  {
    capabilities: { tools: {} },
  },
);

// ---- jitsw_push_surface ----------------------------------------------------

server.registerTool(
  'jitsw_push_surface',
  {
    title: 'Push A2UI surface',
    description:
      "Push a rich A2UI v0.8 surface to the user's phone. Use this whenever you want the user to see structured UI (approval, generated UI, status update). The `messages` array must follow A2UI v0.8 (surfaceUpdate + beginRendering).",
    inputSchema: {
      kind: z
        .enum(['approval', 'alert', 'generated_ui', 'status', 'question'] as [
          PacketKind,
          ...PacketKind[],
        ])
        .describe('Why are you showing this? Drives card style + sort priority.'),
      title: z.string().describe('Short headline for the card and push.'),
      summary: z.string().optional().describe('Optional one-line summary.'),
      messages: z
        .array(z.unknown())
        .describe(
          'Array of A2UI v0.8 protocol messages. Typically a surfaceUpdate followed by beginRendering. See https://a2ui.org for the schema.',
        ),
      riskLevel: z.enum(['low', 'medium', 'high']).optional(),
      reversible: z.boolean().optional(),
      expiresAt: z.string().optional().describe('ISO 8601 expiry timestamp.'),
    },
  },
  async (args) => {
    const packet = await jitsw.push({
      kind: args.kind,
      title: args.title,
      summary: args.summary,
      surface: { version: 'v0.8', messages: args.messages },
      hints: {
        riskLevel: args.riskLevel,
        reversible: args.reversible,
      },
      expiresAt: args.expiresAt,
    });
    return {
      content: [
        {
          type: 'text',
          text: `Pushed packet ${packet.id}. Use jitsw_wait_action to wait for the user's response.`,
        },
      ],
      structuredContent: { packetId: packet.id },
    };
  },
);

// ---- jitsw_send_alert ------------------------------------------------------

server.registerTool(
  'jitsw_send_alert',
  {
    title: 'Send a plain alert',
    description:
      'Send a simple alert with title + body and no interactive surface. Useful for status updates or notifications where no user action is expected.',
    inputSchema: {
      title: z.string(),
      body: z.string(),
      kind: z
        .enum(['alert', 'status'] as ['alert', 'status'])
        .default('alert'),
    },
  },
  async (args) => {
    // Synthesize a minimal A2UI envelope: one text component.
    const packet = await jitsw.push({
      kind: args.kind,
      title: args.title,
      summary: args.body,
      surface: {
        version: 'v0.8',
        messages: [
          {
            surfaceUpdate: {
              surfaceId: 'main',
              components: [
                {
                  id: 'root',
                  component: { Column: { children: { explicitList: ['body'] } } },
                },
                {
                  id: 'body',
                  component: {
                    Text: { text: { literalString: args.body }, usageHint: 'body' },
                  },
                },
              ],
            },
          },
          { beginRendering: { surfaceId: 'main', root: 'root' } },
        ],
      },
    });
    return {
      content: [{ type: 'text', text: `Alert pushed: ${packet.id}` }],
      structuredContent: { packetId: packet.id },
    };
  },
);

// ---- jitsw_wait_action -----------------------------------------------------

server.registerTool(
  'jitsw_wait_action',
  {
    title: "Wait for the user's response",
    description:
      "Block until the user interacts with a previously-pushed packet, or the timeout elapses. Returns the first action.",
    inputSchema: {
      packetId: z.string(),
      timeoutMs: z.number().int().positive().default(300_000),
    },
  },
  async (args) => {
    const action = await jitsw.wait(args.packetId, args.timeoutMs);
    if (!action) {
      return {
        content: [
          { type: 'text', text: `Timed out after ${args.timeoutMs}ms with no user action.` },
        ],
        structuredContent: { timedOut: true },
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `User chose "${action.name}" on packet ${action.packetId}.`,
        },
      ],
      structuredContent: { action },
    };
  },
);

// ---- jitsw_get_actions -----------------------------------------------------

server.registerTool(
  'jitsw_get_actions',
  {
    title: "List the user's actions on a packet",
    description: 'Non-blocking. Returns all actions taken on a packet so far.',
    inputSchema: {
      packetId: z.string(),
    },
  },
  async (args) => {
    const res = await fetch(`${BASE_URL}/actions/by-packet/${args.packetId}`);
    const actions = res.ok ? await res.json() : [];
    return {
      content: [{ type: 'text', text: `${actions.length} action(s) so far.` }],
      structuredContent: { actions },
    };
  },
);

// ---- run -------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // We log to stderr because stdout is the MCP transport.
  console.error(`[jitsw mcp] connected. base=${BASE_URL} agent=${AGENT_ID}`);
}

main().catch((err) => {
  console.error('[jitsw mcp] fatal', err);
  process.exit(1);
});
