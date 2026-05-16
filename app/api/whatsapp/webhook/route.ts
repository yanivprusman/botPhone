import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessionStore';
import { getFlow } from '@/lib/conversations';
import { jidToPhone, parsePlayCommand } from '@/lib/whatsapp';

interface WhatsAppWebhookPayload {
  sender?: string;
  content?: string;
  chatJID?: string;
  isFromMe?: boolean;
  quotedMessageId?: string;
  quotedSender?: string;
  quotedContent?: string;
  messageId?: string;
  mediaType?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as WhatsAppWebhookPayload;

  // Always 200 quickly — the bridge has a 30s timeout and we don't want
  // to block its message-processing pipeline. The flow runs asynchronously.
  if (body.isFromMe) {
    return NextResponse.json({ ignored: 'isFromMe' });
  }

  const content = (body.content ?? '').trim();
  const query = parsePlayCommand(content);
  if (!query) {
    return NextResponse.json({ ignored: 'no play command' });
  }

  const phone = jidToPhone(body.sender ?? body.chatJID ?? '');
  if (!phone) {
    return NextResponse.json({ error: 'could not extract phone from sender JID' }, { status: 400 });
  }

  const flow = getFlow('songOnDemand');
  if (!flow) {
    return NextResponse.json({ error: 'songOnDemand flow missing' }, { status: 500 });
  }

  const session = createSession({
    to: phone,
    flow: 'songOnDemand',
    params: { query },
    source: 'whatsapp',
  });

  flow.run(session).catch((err) => {
    if (!session.error) session.error = err?.message ?? String(err);
    session.done = true;
    session.finishedAt = Date.now();
  });

  return NextResponse.json({
    accepted: true,
    sessionId: session.id,
    to: phone,
    query,
  });
}
