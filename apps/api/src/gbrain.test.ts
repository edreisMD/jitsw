import { describe, expect, it } from 'vitest';
import type { Packet, UserAction } from '@jitsw/shared';
import { _formatters } from './gbrain.js';

const samplePacket: Packet = {
  id: 'pkt_1',
  createdAt: '2026-05-17T00:00:00.000Z',
  agent: { id: 'openclaw.bot', name: 'OpenClaw bot', origin: 'openclaw' },
  kind: 'approval',
  title: 'Approve deploy',
  summary: '3 risky migrations',
  surface: {
    version: 'v0.8',
    messages: [
      { surfaceUpdate: { surfaceId: 'main', components: [] } },
      { beginRendering: { surfaceId: 'main', root: 'root' } },
    ],
  },
  hints: { riskLevel: 'high', reversible: false },
  gbrainCitations: [
    { source: 'jitsw', slug: 'decisions/jitsw/prev-deploy', excerpt: 'Last deploy went fine' },
  ],
};

const sampleAction: UserAction = {
  id: 'act_1',
  packetId: 'pkt_1',
  timestamp: '2026-05-17T00:01:00.000Z',
  name: 'approve',
  surfaceId: 'main',
  sourceComponentId: 'approve_btn',
  context: { reason: 'urgent' },
};

describe('gbrain formatters', () => {
  it('packetToMarkdown produces a sensible page', () => {
    const out = _formatters.packetToMarkdown(samplePacket);
    expect(out.frontmatter).toMatchObject({
      type: 'jitsw.artifact',
      packet_id: 'pkt_1',
      kind: 'approval',
      surface_version: 'v0.8',
    });
    expect(out.body).toContain('# Approve deploy');
    expect(out.body).toContain('3 risky migrations');
    expect(out.body).toContain('## Citations');
    expect(out.body).toContain('jitsw:decisions/jitsw/prev-deploy');
    expect(out.body).toContain('## A2UI envelope');
    expect(out.body).toContain('"version": "v0.8"');
  });

  it('actionToMarkdown links back to the artifact', () => {
    const out = _formatters.actionToMarkdown(sampleAction, samplePacket);
    expect(out.frontmatter).toMatchObject({
      type: 'jitsw.decision',
      action_id: 'act_1',
      packet_id: 'pkt_1',
      action_name: 'approve',
      related_artifact: 'artifacts/jitsw/pkt_1',
    });
    expect(out.body).toContain('# Decision: approve');
    expect(out.body).toContain('Approve deploy');
    expect(out.body).toContain('urgent'); // context shown
  });

  it('actionToMarkdown survives a missing packet reference', () => {
    const out = _formatters.actionToMarkdown(sampleAction);
    expect(out.frontmatter.packet_id).toBe('pkt_1');
    expect(out.body).toContain('# Decision: approve');
  });
});
