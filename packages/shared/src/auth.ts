/**
 * Authentication contract.
 *
 * JITSW's API needs to know who is asking, both for humans (PWA) and agents
 * (SDK / MCP). The shape:
 *
 *   PWA      → Firebase ID token (Google sign-in) → Principal { kind: "human", ... }
 *   Agent    → Bearer API key                     → Principal { kind: "agent", ... }
 *   Matrix   → Matrix access token (self-host)    → Principal { kind: "matrix", ... }
 *
 * Implementations of `AuthVerifier` live in `apps/api/src/auth/*` and are
 * picked at boot by env vars. The interface stays here so the SDK + future
 * Hermes adapters can speak the same vocabulary.
 */

export interface HumanPrincipal {
  kind: 'human';
  /** Stable user id (Firebase uid / Matrix user id / etc.). */
  userId: string;
  email?: string;
  displayName?: string;
}

export interface AgentPrincipal {
  kind: 'agent';
  /** Stable agent id, e.g. "openclaw:demo" or "hermes:research". */
  agentId: string;
  /** Capabilities granted to this key — used for least-privilege gating. */
  scopes: string[];
}

export interface MatrixPrincipal {
  kind: 'matrix';
  userId: string;
  /** Matrix homeserver hostname this principal came from. */
  homeserver: string;
}

export type Principal = HumanPrincipal | AgentPrincipal | MatrixPrincipal;

/**
 * Verify an Authorization header. Returns null on missing/invalid auth so the
 * middleware can decide whether to allow anonymous or reject.
 */
export interface AuthVerifier {
  verify(authHeader: string | undefined): Promise<Principal | null>;
}

/** Standard scopes. */
export const SCOPES = {
  PACKETS_WRITE: 'packets:write',
  PACKETS_READ: 'packets:read',
  ACTIONS_WRITE: 'actions:write',
  ACTIONS_READ: 'actions:read',
  STREAM_SUBSCRIBE: 'stream:subscribe',
} as const;
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
