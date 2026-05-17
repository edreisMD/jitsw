/**
 * Auth middleware factory.
 *
 * Picks an `AuthVerifier` implementation based on env, and returns a Hono
 * middleware that:
 *   - extracts the Authorization header
 *   - asks the verifier to resolve it to a Principal
 *   - attaches the principal to the context as `c.var.principal`
 *   - rejects with 401 if `AUTH_REQUIRED=true` and verification fails
 *
 * Modes:
 *   AUTH_MODE=none      No-op verifier; sets a synthetic dev principal.
 *   AUTH_MODE=firebase  Firebase ID token verification via firebase-admin.
 *   AUTH_MODE=api-keys  Static API key map for agents (no human path).
 *
 * AUTH_REQUIRED defaults to true when AUTH_MODE !== 'none'. Set to "false"
 * to allow anonymous reads (useful for the hosted demo without exposing
 * writes).
 */
import type { MiddlewareHandler } from 'hono';
import type { AuthVerifier, Principal } from '@jitsw/shared';

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal | null;
  }
}

export async function createAuthFromEnv(): Promise<AuthVerifier> {
  const mode = (process.env.AUTH_MODE ?? 'none').toLowerCase();
  switch (mode) {
    case 'none': {
      const { NoneAuth } = await import('./none.js');
      console.log('[auth] mode=none (DEV ONLY — do not expose this to the public internet)');
      return new NoneAuth();
    }
    case 'firebase': {
      const { FirebaseAuth } = await import('./firebase.js');
      console.log('[auth] mode=firebase');
      return new FirebaseAuth();
    }
    case 'api-keys': {
      const { ApiKeyAuth } = await import('./api-keys.js');
      console.log('[auth] mode=api-keys');
      return new ApiKeyAuth();
    }
    default:
      throw new Error(`AUTH_MODE=${mode} not supported`);
  }
}

export function authMiddleware(verifier: AuthVerifier): MiddlewareHandler {
  const required =
    (process.env.AUTH_REQUIRED ?? (process.env.AUTH_MODE === 'none' ? 'false' : 'true')) === 'true';

  return async (c, next) => {
    const header = c.req.header('authorization');
    const principal = await verifier.verify(header).catch((err) => {
      console.warn('[auth] verify threw', err);
      return null;
    });

    c.set('principal', principal);

    // Always permit /health and /stream (the stream endpoint is GET-only and
    // the verifier may still attach a principal to it).
    const path = c.req.path;
    const isPublic = path === '/health';

    if (required && !principal && !isPublic) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  };
}
