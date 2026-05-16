import type { CallSession } from './conversations/types';

// In-memory store. Sessions are short-lived (one call) so persistence isn't
// needed for MVP. Stash on globalThis so HMR / per-route module isolation in
// the Next.js dev server doesn't give different routes different Maps.
const g = globalThis as unknown as { __botPhoneSessions?: Map<string, CallSession> };
if (!g.__botPhoneSessions) g.__botPhoneSessions = new Map();
const sessions = g.__botPhoneSessions;

export function createSession(opts: {
  to: string;
  flow: string;
  params?: Record<string, unknown>;
  source?: CallSession['source'];
}): CallSession {
  const id = `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session: CallSession = {
    id,
    to: opts.to,
    flow: opts.flow,
    params: opts.params ?? {},
    source: opts.source ?? 'api',
    events: [],
    done: false,
    startedAt: Date.now(),
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string): CallSession | undefined {
  return sessions.get(id);
}

export function listSessions(): CallSession[] {
  return Array.from(sessions.values()).sort((a, b) => b.startedAt - a.startedAt);
}
