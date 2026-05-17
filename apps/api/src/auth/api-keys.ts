/**
 * Static API-key verifier for agents.
 *
 * Use this when humans authenticate elsewhere (Firebase) but agents need a
 * stable bearer credential. Keys are read from env at boot:
 *
 *   AGENT_KEYS='[
 *     { "key": "k_demo_xxx", "agentId": "openclaw:demo",  "scopes": ["packets:write","actions:read"] },
 *     { "key": "k_cron_yyy", "agentId": "gbrain:cron",    "scopes": ["packets:write"] }
 *   ]'
 *
 * Keys are compared with constant-time equality.
 *
 * For more than a handful of agents, replace this with a database-backed key
 * store that supports rotation and revocation. The interface (`AuthVerifier`)
 * stays the same.
 */
import { timingSafeEqual } from 'node:crypto';
import type { AuthVerifier, Principal } from '@jitsw/shared';

interface Entry {
  key: string;
  agentId: string;
  scopes: string[];
}

export class ApiKeyAuth implements AuthVerifier {
  private entries: Entry[];

  constructor(raw = process.env.AGENT_KEYS) {
    if (!raw) {
      this.entries = [];
      console.warn('[auth/api-keys] AGENT_KEYS unset — no agents will authenticate');
      return;
    }
    try {
      this.entries = JSON.parse(raw) as Entry[];
    } catch (err) {
      throw new Error(`[auth/api-keys] AGENT_KEYS must be JSON array: ${(err as Error).message}`);
    }
  }

  async verify(authHeader: string | undefined): Promise<Principal | null> {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const key = authHeader.slice('Bearer '.length);
    const keyBuf = Buffer.from(key);
    for (const entry of this.entries) {
      const candidate = Buffer.from(entry.key);
      if (candidate.length === keyBuf.length && timingSafeEqual(candidate, keyBuf)) {
        return { kind: 'agent', agentId: entry.agentId, scopes: entry.scopes };
      }
    }
    return null;
  }
}
