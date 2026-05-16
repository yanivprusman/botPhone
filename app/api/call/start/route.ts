import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessionStore';
import { getFlow } from '@/lib/conversations';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const to = String(body.to || '').trim();
  const flowId = String(body.flow || 'songRequest');

  if (!to) {
    return NextResponse.json({ error: 'to (phone number) is required' }, { status: 400 });
  }
  const flow = getFlow(flowId);
  if (!flow) {
    return NextResponse.json({ error: `Unknown flow: ${flowId}` }, { status: 400 });
  }

  const session = createSession(to, flowId);

  // Kick off the flow asynchronously — return the session id immediately so
  // the UI can start polling for status.
  flow.run(session).catch((err) => {
    if (!session.error) session.error = err?.message ?? String(err);
    session.done = true;
    session.finishedAt = Date.now();
  });

  return NextResponse.json({ sessionId: session.id, flow: flowId, to });
}
