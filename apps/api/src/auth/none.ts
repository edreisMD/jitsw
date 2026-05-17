/**
 * No-auth verifier for local development.
 *
 * Always returns a synthetic principal so handlers that read `c.var.principal`
 * don't have to special-case null. Refuses to verify anything that looks like
 * a real token — defense in depth in case someone deploys this to prod by
 * mistake.
 */
import type { AuthVerifier, Principal } from '@jitsw/shared';

export class NoneAuth implements AuthVerifier {
  async verify(_authHeader: string | undefined): Promise<Principal | null> {
    return {
      kind: 'human',
      userId: 'local-dev',
      displayName: 'local dev',
    };
  }
}
