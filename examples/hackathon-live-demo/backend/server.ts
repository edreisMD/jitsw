import { createPublicKey, verify as verifySignature } from 'node:crypto';

type AgentEvent = {
  id: string;
  created_at: string;
  agent: string;
  channel: string;
  type: string;
  title: string;
  summary: string;
  artifact_url?: string;
  a2ui?: unknown;
  status?: string;
};

type ApprovalInput = {
  decision: 'approved' | 'rejected' | 'changes';
  title: string;
  reason?: string;
  agent?: string;
  channel?: string;
};

type AuthUser = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
};

const env = {
  port: Number(Bun.env.JITSW_PORT ?? 4177),
  authRequired: Bun.env.AUTH_REQUIRED === 'true',
  agentApiKey: Bun.env.JITSW_AGENT_API_KEY ?? '',
  firebaseProjectId: Bun.env.FIREBASE_PROJECT_ID ?? '',
  firebaseApiKey: Bun.env.FIREBASE_API_KEY ?? '',
  firebaseAuthDomain: Bun.env.FIREBASE_AUTH_DOMAIN ?? '',
  firebaseAppId: Bun.env.FIREBASE_APP_ID ?? '',
  firebaseMessagingSenderId: Bun.env.FIREBASE_MESSAGING_SENDER_ID ?? '',
  allowedEmails: (Bun.env.JITSW_ALLOWED_EMAILS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
  allowedEmailDomains: (Bun.env.JITSW_ALLOWED_EMAIL_DOMAINS ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
  matrixHomeserverUrl: Bun.env.MATRIX_HOMESERVER_URL ?? 'http://localhost:8008',
  matrixUser: Bun.env.MATRIX_USER ?? 'openclaw-bot',
  matrixPassword: Bun.env.MATRIX_PASSWORD ?? 'jitsw-demo-bot',
  matrixHumanUser: Bun.env.MATRIX_HUMAN_USER ?? 'jitsw-human',
  matrixHumanPassword: Bun.env.MATRIX_HUMAN_PASSWORD ?? 'jitsw-demo-human-2',
  matrixRoomId: Bun.env.MATRIX_ROOM_ID ?? '',
  matrixRoomName: Bun.env.MATRIX_ROOM_NAME ?? 'JITSW Demo',
  gbrainMcpUrl: Bun.env.GBRAIN_MCP_URL ?? 'http://localhost:3131/mcp',
  gbrainBearerToken: Bun.env.GBRAIN_BEARER_TOKEN ?? '',
  gbrainSource: Bun.env.GBRAIN_SOURCE ?? 'jitsw-demo',
};

const uiRoot = new URL('../ui/', import.meta.url);
const stateFile = new URL('./.jitsw-state.json', import.meta.url);
const events: AgentEvent[] = [];
let matrixSession: { accessToken: string; userId: string; roomId: string } | null = null;
let humanMatrixSession: { accessToken: string; userId: string; roomId: string } | null = null;
let stateCache: {
  matrix_room_id?: string;
  matrix_access_token?: string;
  matrix_user_id?: string;
  human_matrix_access_token?: string;
  human_matrix_user_id?: string;
} | null = null;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-JITSW-Agent-Key',
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      'Cache-Control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'decision';
}

function readJson<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

const firebaseCertUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let firebaseCertCache: { expiresAt: number; certs: Record<string, string> } | null = null;

function firebaseAuthConfigured() {
  return !!(env.firebaseProjectId && env.firebaseApiKey && env.firebaseAuthDomain && env.firebaseAppId);
}

function base64urlToBuffer(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(base64urlToBuffer(part).toString('utf8')) as T;
}

async function getFirebaseCerts() {
  const now = Date.now();
  if (firebaseCertCache && firebaseCertCache.expiresAt > now) return firebaseCertCache.certs;

  const response = await fetch(firebaseCertUrl);
  if (!response.ok) throw new HttpError(503, 'firebase_certs_unavailable');
  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 300);
  const certs = await response.json() as Record<string, string>;
  firebaseCertCache = { certs, expiresAt: now + maxAge * 1000 };
  return certs;
}

async function verifyFirebaseIdToken(idToken: string): Promise<AuthUser> {
  if (!env.firebaseProjectId) throw new HttpError(500, 'firebase_project_not_configured');
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'invalid_firebase_token');

  const header = decodeJwtPart<{ alg?: string; kid?: string }>(parts[0]);
  const payload = decodeJwtPart<Record<string, unknown>>(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'invalid_firebase_token_header');

  const certs = await getFirebaseCerts();
  const cert = certs[header.kid];
  if (!cert) throw new HttpError(401, 'unknown_firebase_key');

  const validSignature = verifySignature(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey(cert),
    base64urlToBuffer(parts[2]),
  );
  if (!validSignature) throw new HttpError(401, 'invalid_firebase_signature');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuer = `https://securetoken.google.com/${env.firebaseProjectId}`;
  if (payload.aud !== env.firebaseProjectId || payload.iss !== issuer) throw new HttpError(401, 'invalid_firebase_audience');
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) throw new HttpError(401, 'firebase_token_expired');
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 60) throw new HttpError(401, 'invalid_firebase_iat');
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) {
    throw new HttpError(401, 'invalid_firebase_subject');
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  };
}

function emailAllowed(email?: string) {
  if (env.allowedEmails.length === 0 && env.allowedEmailDomains.length === 0) return true;
  if (!email) return false;
  const normalized = email.toLowerCase();
  const domain = normalized.split('@')[1] ?? '';
  return env.allowedEmails.includes(normalized) || env.allowedEmailDomains.includes(domain);
}

async function requireHuman(request: Request): Promise<AuthUser | null> {
  if (!env.authRequired) return null;
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, 'missing_firebase_bearer_token');

  const user = await verifyFirebaseIdToken(match[1]);
  if (!emailAllowed(user.email)) throw new HttpError(403, 'email_not_allowed');
  return user;
}

function requireAgent(request: Request) {
  if (!env.authRequired && !env.agentApiKey) return;
  if (env.agentApiKey && request.headers.get('x-jitsw-agent-key') === env.agentApiKey) return;
  throw new HttpError(401, 'missing_or_invalid_agent_key');
}

async function readState() {
  if (stateCache) return stateCache;
  const file = Bun.file(stateFile);
  if (!(await file.exists())) {
    stateCache = {};
    return stateCache;
  }
  try {
    stateCache = JSON.parse(await file.text());
  } catch {
    stateCache = {};
  }
  return stateCache;
}

async function writeState(next: {
  matrix_room_id?: string;
  matrix_access_token?: string;
  matrix_user_id?: string;
  human_matrix_access_token?: string;
  human_matrix_user_id?: string;
}) {
  stateCache = { ...(stateCache ?? {}), ...next };
  await Bun.write(stateFile, JSON.stringify(stateCache, null, 2));
}

async function matrixFetch(path: string, init: RequestInit = {}) {
  const url = `${env.matrixHomeserverUrl}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`Matrix ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as any;
}

async function ensureMatrixSession() {
  if (matrixSession) return matrixSession;
  const state = await readState();
  if (state.matrix_access_token && state.matrix_user_id && state.matrix_room_id) {
    matrixSession = {
      accessToken: state.matrix_access_token,
      userId: state.matrix_user_id,
      roomId: state.matrix_room_id,
    };
    return matrixSession;
  }

  const login = await matrixFetch('/_matrix/client/v3/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: env.matrixUser },
      password: env.matrixPassword,
    }),
  });

  let roomId = env.matrixRoomId || state.matrix_room_id || '';
  if (!roomId) {
    const room = await matrixFetch('/_matrix/client/v3/createRoom', {
      method: 'POST',
      headers: { Authorization: `Bearer ${login.access_token}` },
      body: JSON.stringify({
        name: env.matrixRoomName,
        topic: 'JITSW demo room for agent-human approvals',
        preset: 'private_chat',
        visibility: 'private',
      }),
    });
    roomId = room.room_id;
    await writeState({ matrix_room_id: roomId });
  }

  matrixSession = {
    accessToken: login.access_token,
    userId: login.user_id,
    roomId,
  };
  await writeState({
    matrix_room_id: roomId,
    matrix_access_token: login.access_token,
    matrix_user_id: login.user_id,
  });
  return matrixSession;
}

async function ensureHumanMatrixSession() {
  if (humanMatrixSession) return humanMatrixSession;
  const state = await readState();
  if (state.human_matrix_access_token && state.human_matrix_user_id && state.matrix_room_id) {
    humanMatrixSession = {
      accessToken: state.human_matrix_access_token,
      userId: state.human_matrix_user_id,
      roomId: state.matrix_room_id,
    };
    await ensureHumanJoinedRoom(humanMatrixSession);
    return humanMatrixSession;
  }

  const login = await matrixFetch('/_matrix/client/v3/login', {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: env.matrixHumanUser },
      password: env.matrixHumanPassword,
    }),
  });

  const roomId = env.matrixRoomId || state.matrix_room_id;
  if (!roomId) throw new HttpError(503, 'matrix_room_not_ready');

  humanMatrixSession = {
    accessToken: login.access_token,
    userId: login.user_id,
    roomId,
  };
  await ensureHumanJoinedRoom(humanMatrixSession);
  await writeState({
    matrix_room_id: roomId,
    human_matrix_access_token: login.access_token,
    human_matrix_user_id: login.user_id,
  });
  return humanMatrixSession;
}

async function ensureHumanJoinedRoom(session: { accessToken: string; userId: string; roomId: string }) {
  const botSession = await ensureMatrixSession();
  if (session.userId === botSession.userId) return;

  try {
    await matrixFetch(`/_matrix/client/v3/rooms/${encodeURIComponent(session.roomId)}/invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${botSession.accessToken}` },
      body: JSON.stringify({ user_id: session.userId }),
    });
  } catch {
    // Already-joined/already-invited Matrix errors are fine for this idempotent demo setup.
  }

  try {
    await matrixFetch(`/_matrix/client/v3/join/${encodeURIComponent(session.roomId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({}),
    });
  } catch {
    // If the user was already joined, some homeservers return an error. The next send is the real check.
  }
}

async function sendMatrixPacket(packet: Record<string, unknown>) {
  const session = await ensureMatrixSession();
  const txnId = `jitsw-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return matrixFetch(
    `/_matrix/client/v3/rooms/${encodeURIComponent(session.roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({
        msgtype: 'm.notice',
        body: String(packet.title ?? packet.type ?? 'JITSW event'),
        'org.jitsw.packet': packet,
      }),
    },
  );
}

async function sendHumanMatrixMessage(body: string) {
  const session = await ensureHumanMatrixSession();
  const txnId = `jitsw-human-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return matrixFetch(
    `/_matrix/client/v3/rooms/${encodeURIComponent(session.roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({
        msgtype: 'm.text',
        body,
      }),
    },
  );
}

function buildJitswChatPrompt(text: string) {
  return [
    `JITSW user request: ${text}`,
    '',
    'Respond only with one complete compact fenced JSON A2UI v0.9 object.',
    'Use this shape: {"a2ui":"0.9","surface":{...}}.',
    'Use only supported components: Column, Row, Card, Text, Button.',
    'The UI must be functional on a phone and include useful buttons when a decision is possible.',
    'Do not send prose, markdown explanation, or status text outside the JSON fence.',
    'Keep the JSON concise enough to fit in one Matrix message.',
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeA2ui(payload: unknown): boolean {
  if (Array.isArray(payload)) return payload.some(looksLikeA2ui);
  if (!isRecord(payload)) return false;
  if ('createSurface' in payload || 'updateComponents' in payload || 'surfaceUpdate' in payload || 'beginRendering' in payload) {
    return true;
  }
  if (typeof payload.a2ui === 'string' && isRecord(payload.surface)) return true;
  if (typeof payload.type === 'string' && (payload.type === 'Column' || payload.type === 'Row' || payload.type === 'Card')) return true;
  return false;
}

function parseA2uiCandidate(candidate: string): unknown | null {
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return looksLikeA2ui(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractA2uiFromText(body: string): unknown | null {
  const fences = body.matchAll(/```(?:json|a2ui)?\s*([\s\S]*?)```/gi);
  for (const fence of fences) {
    const parsed = parseA2uiCandidate(fence[1]);
    if (parsed) return parsed;
  }
  return parseA2uiCandidate(body);
}

function stripFenceLines(body: string) {
  return body
    .split('\n')
    .filter((line) => !/^```(?:json|a2ui)?\s*$/i.test(line.trim()))
    .join('\n')
    .trim();
}

function extractA2uiFromSplitBodies(bodiesChronological: string[]): unknown | null {
  const jsonish = bodiesChronological
    .map(stripFenceLines)
    .filter((body) => {
      const trimmed = body.trim();
      return (
        trimmed.startsWith('{') ||
        trimmed.startsWith('[') ||
        trimmed.startsWith('"') ||
        trimmed.includes('"a2ui"') ||
        trimmed.includes('"surface"') ||
        trimmed.includes('"type"')
      );
    });

  if (jsonish.length < 2) return null;
  return parseA2uiCandidate(jsonish.join('\n'));
}

async function readMatrixPackets(limit = 40) {
  const session = await ensureMatrixSession();
  const response = await matrixFetch(
    `/_matrix/client/v3/rooms/${encodeURIComponent(session.roomId)}/messages?dir=b&limit=${limit}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  const chunks = Array.isArray(response.chunk) ? response.chunk : [];
  return chunks
    .map((item: any) => item?.content?.['org.jitsw.packet'])
    .filter((packet: unknown): packet is AgentEvent => {
      return !!packet && typeof packet === 'object' && typeof (packet as AgentEvent).id === 'string';
    });
}

async function readMatrixTimeline(limit = 160) {
  const session = await ensureMatrixSession();
  const response = await matrixFetch(
    `/_matrix/client/v3/rooms/${encodeURIComponent(session.roomId)}/messages?dir=b&limit=${limit}`,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  const chunks = Array.isArray(response.chunk) ? response.chunk : [];
  const seenEvents = new Set<string>();
  const rows = chunks.flatMap((item: any) => {
    const rawContent = item?.content ?? {};
    const relation = rawContent['m.relates_to'];
    const replacementTarget = relation?.rel_type === 'm.replace' && typeof relation.event_id === 'string'
      ? relation.event_id
      : null;
    const visibleEventId = replacementTarget ?? item?.event_id;
    if (visibleEventId && seenEvents.has(visibleEventId)) return [];
    if (visibleEventId) seenEvents.add(visibleEventId);

    const content = rawContent['m.new_content'] ?? rawContent;
    const packet = content['org.jitsw.packet'] ?? rawContent['org.jitsw.packet'] ?? null;
    const body = typeof content.body === 'string' ? content.body : typeof rawContent.body === 'string' ? rawContent.body : '';
    return [{
      event_id: item?.event_id,
      visible_event_id: visibleEventId,
      sender: item?.sender,
      origin_server_ts: item?.origin_server_ts,
      type: item?.type,
      body,
      packet,
      a2ui: packet?.a2ui ?? content['com.openclaw.presentation'] ?? extractA2uiFromText(body),
    }];
  });

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.a2ui || !String(row.sender ?? '').includes('openclaw')) continue;

    const bodiesNewestFirst: string[] = [];
    const startTs = Number(row.origin_server_ts ?? 0);
    for (let cursor = index; cursor < rows.length; cursor += 1) {
      const next = rows[cursor];
      if (next.sender !== row.sender) break;
      const nextTs = Number(next.origin_server_ts ?? 0);
      if (startTs && nextTs && Math.abs(startTs - nextTs) > 10_000) break;
      bodiesNewestFirst.push(next.body);
    }

    const reconstructed = extractA2uiFromSplitBodies(bodiesNewestFirst.reverse());
    if (reconstructed) row.a2ui = reconstructed;
  }

  return rows;
}

async function callGbrain(name: string, args: Record<string, unknown>) {
  if (!env.gbrainBearerToken) {
    return { skipped: true, reason: 'GBRAIN_BEARER_TOKEN is not set' };
  }

  const response = await fetch(env.gbrainMcpUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.gbrainBearerToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `jitsw-${Date.now()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GBrain ${response.status}: ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function decisionMarkdown(input: ApprovalInput) {
  const now = new Date().toISOString();
  return `---
type: decision
source: jitsw
agent: ${input.agent ?? 'hermes-builder'}
channel: ${input.channel ?? 'engineering'}
decision: ${input.decision}
created_at: ${now}
tags:
  - jitsw
  - agent-approval
---

# ${input.title}

Decision: ${input.decision}

Reason: ${input.reason ?? 'No reason provided.'}

---

<!-- timeline -->

## Timeline

- ${now.slice(0, 10)} - [Source: JITSW approval] ${input.decision}: ${input.title}
`;
}

function demoA2uiSurface() {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'approval',
        catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'approval',
        components: [
          { id: 'root', component: 'Column', children: ['kicker', 'title', 'summary', 'risk', 'actions'] },
          { id: 'kicker', component: 'Text', text: 'A2UI surface from Hermes', variant: 'caption' },
          { id: 'title', component: 'Text', text: 'Customer feedback triage', variant: 'h2' },
          {
            id: 'summary',
            component: 'Text',
            text: 'I generated a phone-ready approval workflow from the onboarding complaints in GBrain.',
          },
          {
            id: 'risk',
            component: 'Card',
            child: 'riskText',
          },
          {
            id: 'riskText',
            component: 'Text',
            text: 'Risk: opens a PR that changes first-run onboarding copy. Needs human approval.',
          },
          { id: 'actions', component: 'Row', children: ['approve', 'changes'] },
          {
            id: 'approve',
            component: 'Button',
            text: 'Approve',
            variant: 'primary',
            action: { event: { name: 'jitsw.approve' } },
          },
          {
            id: 'changes',
            component: 'Button',
            text: 'Changes',
            action: { event: { name: 'jitsw.request_changes' } },
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'approval',
        path: '/approval',
        value: { owner: 'Eduardo', memorySource: 'jitsw-demo', agent: 'hermes-builder' },
      },
    },
  ];
}

async function handleAgentEvent(request: Request) {
  const input = await readJson<Partial<AgentEvent>>(request);
  if (!input.title || !input.summary) {
    return json({ error: 'title and summary are required' }, { status: 400 });
  }

  const event: AgentEvent = {
    id: `evt_${Date.now()}`,
    created_at: new Date().toISOString(),
    agent: input.agent ?? 'hermes-builder',
    channel: input.channel ?? 'engineering',
    type: input.type ?? 'approval_request',
    title: input.title,
    summary: input.summary,
    artifact_url: input.artifact_url,
    a2ui: input.a2ui,
    status: input.status ?? 'needs_review',
  };

  events.unshift(event);
  const matrix = await sendMatrixPacket({ ...event, kind: 'agent_event' });
  return json({ event, matrix });
}

async function handleDemoA2ui() {
  const event: AgentEvent = {
    id: `evt_${Date.now()}`,
    created_at: new Date().toISOString(),
    agent: 'hermes-builder',
    channel: 'engineering',
    type: 'a2ui_approval_request',
    title: 'Customer feedback triage',
    summary: 'Hermes sent an A2UI approval surface over the Matrix-backed JITSW channel.',
    a2ui: demoA2uiSurface(),
    status: 'needs_review',
  };

  events.unshift(event);
  const matrix = await sendMatrixPacket({ ...event, kind: 'agent_event' });
  return json({ event, matrix });
}

async function handleApproval(request: Request, user: AuthUser | null) {
  const input = await readJson<ApprovalInput>(request);
  if (!['approved', 'rejected', 'changes'].includes(input.decision) || !input.title) {
    return json({ error: 'decision and title are required' }, { status: 400 });
  }

  const approvalEvent: AgentEvent = {
    id: `decision_${Date.now()}`,
    created_at: new Date().toISOString(),
    agent: input.agent ?? user?.email ?? 'human',
    channel: input.channel ?? 'engineering',
    type: 'approval_decision',
    title: input.title,
    summary: input.reason ?? input.decision,
    status: input.decision,
  };
  events.unshift(approvalEvent);

  const matrix = await sendMatrixPacket({ ...approvalEvent, kind: 'approval_decision', human: user });
  const slug = `decisions/${slugify(input.title)}-${approvalEvent.created_at.slice(0, 10)}`;
  const content = decisionMarkdown(input);
  const gbrainPut = await callGbrain('put_page', { slug, content });
  const gbrainFacts = await callGbrain('extract_facts', {
    turn_text: `${input.title}: ${input.decision}. ${input.reason ?? ''}`.trim(),
    session_id: approvalEvent.id,
    visibility: 'world',
  });

  return json({ event: approvalEvent, matrix, gbrain: { put_page: gbrainPut, extract_facts: gbrainFacts } });
}

async function handleChat(request: Request, user: AuthUser | null) {
  const input = await readJson<{ message?: string; command?: string }>(request);
  const text = (input.message ?? input.command ?? '').trim();
  if (!text) return json({ error: 'message is required' }, { status: 400 });

  const prefix = user?.email ? `${user.email}: ` : '';
  const matrix = await sendHumanMatrixMessage(`${prefix}${buildJitswChatPrompt(text)}`);
  return json({ ok: true, matrix });
}

function commandCatalog() {
  return {
    gbrain: [
      { id: 'gbrain.query', label: 'GBrain query', prompt: '/gbrain query "What context matters for this decision?"' },
      { id: 'gbrain.search', label: 'Search memory', prompt: '/gbrain search "JITSW Matrix A2UI decisions"' },
      { id: 'gbrain.put-page', label: 'Save decision', prompt: '/gbrain put_page decisions/jitsw-next-step.md' },
    ],
    gstack: [
      { id: 'gstack.office-hours', label: 'Office hours', prompt: '/office-hours brainstorm the next JITSW demo wedge' },
      { id: 'gstack.qa', label: 'QA UI', prompt: '/qa test the JITSW phone UI and fix rough edges' },
      { id: 'gstack.ship', label: 'Ship PR', prompt: '/ship prepare the JITSW demo for open source release' },
    ],
    openclaw: [
      { id: 'openclaw.new-agent', label: 'New agent', prompt: '/agents create a JITSW demo worker for A2UI-over-Matrix' },
      { id: 'openclaw.a2ui', label: 'Send UI', prompt: 'Respond with an A2UI v0.9 surface for this request, not plain text.' },
      { id: 'openclaw.status', label: 'Status', prompt: '/status summarize active channels, GBrain, and Matrix health' },
    ],
  };
}

async function serveStatic(pathname: string) {
  const clean = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  if (clean.includes('..')) return null;
  const fileUrl = new URL(clean.replace(/^\/+/, ''), uiRoot);
  if (!fileUrl.pathname.startsWith(uiRoot.pathname)) return null;
  const file = Bun.file(fileUrl);
  if (!(await file.exists())) return null;
  return new Response(file, { headers: { 'Cache-Control': 'no-store' } });
}

Bun.serve({
  port: env.port,
  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method === 'GET' && url.pathname === '/api/status') {
        const matrixVersions = await matrixFetch('/_matrix/client/versions');
        const state = await readState();
        return json({
          ok: true,
          auth: {
            required: env.authRequired,
            firebase_configured: firebaseAuthConfigured(),
            allowed_emails: env.allowedEmails.length,
            allowed_domains: env.allowedEmailDomains,
            agent_key_configured: !!env.agentApiKey,
          },
          matrix: { homeserver: env.matrixHomeserverUrl, versions: matrixVersions.versions?.slice?.(0, 4) ?? [] },
          room: { id: env.matrixRoomId || state.matrix_room_id || null },
          gbrain: { mcp_url: env.gbrainMcpUrl, token_configured: !!env.gbrainBearerToken },
          events: { memory: events.length, matrix_history_endpoint: '/api/events' },
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        return json({
          auth: {
            required: env.authRequired,
            firebase: firebaseAuthConfigured()
              ? {
                apiKey: env.firebaseApiKey,
                authDomain: env.firebaseAuthDomain,
                projectId: env.firebaseProjectId,
                appId: env.firebaseAppId,
                messagingSenderId: env.firebaseMessagingSenderId || undefined,
              }
              : null,
          },
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/commands') {
        return json(commandCatalog());
      }

      if (request.method === 'GET' && url.pathname === '/api/events') {
        await requireHuman(request);
        const matrixEvents = await readMatrixPackets();
        const byId = new Map<string, AgentEvent>();
        for (const event of [...events, ...matrixEvents]) byId.set(event.id, event);
        const merged = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
        return json({ events: merged });
      }

      if (request.method === 'GET' && url.pathname === '/api/messages') {
        await requireHuman(request);
        return json({ messages: await readMatrixTimeline() });
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const user = await requireHuman(request);
        return handleChat(request, user);
      }

      if (request.method === 'POST' && url.pathname === '/api/agent-events') {
        requireAgent(request);
        return handleAgentEvent(request);
      }

      if (request.method === 'POST' && url.pathname === '/api/demo-a2ui') {
        requireAgent(request);
        return handleDemoA2ui();
      }

      if (request.method === 'POST' && url.pathname === '/api/approvals') {
        const user = await requireHuman(request);
        return handleApproval(request, user);
      }

      const staticResponse = await serveStatic(url.pathname);
      if (staticResponse) return staticResponse;
      return json({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      return json({
        error: error instanceof HttpError ? 'request_error' : 'server_error',
        message: error instanceof Error ? error.message : String(error),
      }, { status: error instanceof HttpError ? error.status : 500 });
    }
  },
});

console.log(`JITSW backend listening on http://localhost:${env.port}`);
