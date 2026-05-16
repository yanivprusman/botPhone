import type { CallSession } from './conversations/types';

// In-memory store. Sessions are short-lived (one call) so persistence isn't
// needed for MVP. If the dev server restarts mid-call, the UI just polls and
// finds nothing — caller picks up and tries again.
const sessions = new Map<string, CallSession>();

export function createSession(to: string, flow: string): CallSession {
  const id = `bp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session: CallSession = {
    id,
    to,
    flow,
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
