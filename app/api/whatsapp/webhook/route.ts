import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessionStore';
import { getFlow } from '@/lib/conversations';
import { jidToPhone, parsePlayCommand, sendWhatsApp } from '@/lib/whatsapp';

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

/** True if the chat JID refers to a 1:1 conversation (not a group). Group JIDs
 *  end with @g.us; 1:1 use @s.whatsapp.net. We only reply with the usage hint
 *  in 1:1s to avoid spamming groups when someone says something unrelated. */
function isDirectChat(chatJID?: string): boolean {
  if (!chatJID) return false;
  return chatJID.endsWith('@s.whatsapp.net') || /^\d+$/.test(chatJID);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as WhatsAppWebhookPayload;

  // Always 200 quickly — the bridge has a 30s timeout and we don't want
  // to block its message-processing pipeline. The flow runs asynchronously.
  if (body.isFromMe) {
    return NextResponse.json({ ignored: 'isFromMe' });
  }

  // Who we reply to. Prefer the chat (works for both 1:1 and groups); fall
  // back to the sender phone (1:1 only).
  const replyTo = body.chatJID || body.sender || '';

  const content = (body.content ?? '').trim();
  const query = parsePlayCommand(content);
  if (!query) {
    // Wrong format — send a usage hint, but only in direct chats (no groups).
    if (replyTo && isDirectChat(body.chatJID) && content.length > 0) {
      void sendWhatsApp(replyTo, "Send `play <song name>` to request a song.");
    }
    return NextResponse.json({ ignored: 'no play command' });
  }

  const phone = jidToPhone(body.sender ?? body.chatJID ?? '');
  if (!phone) {
    if (replyTo) {
      void sendWhatsApp(replyTo, "Sorry, I couldn't figure out your phone number.");
    }
    return NextResponse.json({ error: 'could not extract phone from sender JID' }, { status: 400 });
  }

  const flow = getFlow('songOnDemand');
  if (!flow) {
    return NextResponse.json({ error: 'songOnDemand flow missing' }, { status: 500 });
  }

  const session = createSession({
    to: phone,
    flow: 'songOnDemand',
    params: { query, replyTo },
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
