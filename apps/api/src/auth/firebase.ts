/**
 * Firebase Auth verifier.
 *
 * Validates Firebase ID tokens (Google sign-in, GitHub, etc.) using
 * firebase-admin. The PWA gets a token from the Firebase JS SDK and sends it
 * as `Authorization: Bearer <id-token>`. The admin SDK verifies signature +
 * expiry + audience using Google's public certs.
 *
 * Setup:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *      (or, on Cloud Run, automatic via Workload Identity / default creds)
 *   FIREBASE_PROJECT_ID=<your-project>
 *
 * Optional:
 *   AUTH_ALLOWED_DOMAINS=acme.com,example.org   - email-domain allowlist
 *
 * This file lazy-imports firebase-admin so dev installs without it don't
 * break (NoneAuth is the default).
 */
import type { AuthVerifier, Principal } from '@jitsw/shared';

export class FirebaseAuth implements AuthVerifier {
  private auth?: import('firebase-admin/auth').Auth;
  private allowedDomains?: string[];

  async verify(authHeader: string | undefined): Promise<Principal | null> {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length);

    const auth = await this.lazyInit();
    if (!auth) return null;

    let decoded: import('firebase-admin/auth').DecodedIdToken;
    try {
      decoded = await auth.verifyIdToken(token);
    } catch {
      return null;
    }

    const email = decoded.email;
    if (this.allowedDomains && this.allowedDomains.length > 0) {
      const domain = email?.split('@')[1]?.toLowerCase();
      if (!domain || !this.allowedDomains.includes(domain)) return null;
    }

    return {
      kind: 'human',
      userId: decoded.uid,
      email,
      displayName: decoded.name as string | undefined,
    };
  }

  private async lazyInit(): Promise<import('firebase-admin/auth').Auth | null> {
    if (this.auth) return this.auth;
    try {
      const { initializeApp, applicationDefault, getApps } = await import('firebase-admin/app');
      const { getAuth } = await import('firebase-admin/auth');
      if (getApps().length === 0) {
        initializeApp({
          credential: applicationDefault(),
          projectId: process.env.FIREBASE_PROJECT_ID,
        });
      }
      this.auth = getAuth();
      this.allowedDomains = process.env.AUTH_ALLOWED_DOMAINS?.split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      return this.auth;
    } catch (err) {
      console.error(
        '[auth/firebase] firebase-admin not installed or misconfigured — install it for hosted deployments',
        err,
      );
      return null;
    }
  }
}
