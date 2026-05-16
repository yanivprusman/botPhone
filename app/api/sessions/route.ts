import { NextResponse } from 'next/server';
import { listSessions } from '@/lib/sessionStore';

export async function GET() {
  // Most recent first, no body for events (keep response light).
  const summarized = listSessions().map((s) => ({
    id: s.id,
    to: s.to,
    flow: s.flow,
    source: s.source,
    params: s.params,
    done: s.done,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    error: s.error,
    songTitle: s.songTitle,
    transcript: s.transcript,
    lastStage: s.events[s.events.length - 1]?.stage,
    eventCount: s.events.length,
  }));
  return NextResponse.json({ sessions: summarized });
}
