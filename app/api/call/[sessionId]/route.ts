import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/sessionStore';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await ctx.params;
  const session = getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json(session);
}
