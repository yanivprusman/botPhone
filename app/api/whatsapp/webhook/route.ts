import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessionStore';
import { getFlow } from '@/lib/conversations';
import { jidToPhone, parsePlayCommand, sendWhatsApp } from '@/lib/whatsapp';
import { getUserPrefs, saveUserPrefs } from '@/lib/users';

const WELCOME_MESSAGE =
  "Hi! When you send `play <song>`, I'll search YouTube and call you back to play it.\n\n" +
  "Example: `play tom petty free fallin'`\n\n" +
  "I'll send you 4 progress updates per request (Got it, Found, Done, plus a yearly tip-jar nudge).\n\n" +
  "Reply `no updates` to mute the per-request messages anytime.";

const OPT_OUT_PHRASES = ['no updates'];
const OPT_IN_PHRASES = ['updates on'];

function matchesAny(content: string, phrases: string[]): boolean {
  const normalized = content.trim().toLowerCase();
  return phrases.some((p) => normalized === p);
}

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
  const userKey = body.sender || body.chatJID || '';
  const content = (body.content ?? '').trim();

  // Opt-in / opt-out commands first — these short-circuit before any other parsing.
  if (matchesAny(content, OPT_OUT_PHRASES)) {
    const prefs = await getUserPrefs(userKey);
    prefs.optOut = true;
    await saveUserPrefs(userKey, prefs);
    if (replyTo) void sendWhatsApp(replyTo, "OK, no more progress updates. Send `updates on` anytime to re-enable.");
    return NextResponse.json({ optedOut: true });
  }
  if (matchesAny(content, OPT_IN_PHRASES)) {
    const prefs = await getUserPrefs(userKey);
    prefs.optOut = false;
    await saveUserPrefs(userKey, prefs);
    if (replyTo) void sendWhatsApp(replyTo, "Updates re-enabled.");
    return NextResponse.json({ optedIn: true });
  }

  const query = parsePlayCommand(content);
  if (!query) {
    // Wrong format — send a usage hint, but only in direct chats (no groups).
    if (replyTo && isDirectChat(body.chatJID) && content.length > 0) {
      void sendWhatsApp(
        replyTo,
        "Send `play <song name>` to request a song. Example: `play tom petty free fallin'`",
      );
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

  // First-time user? Send the welcome before the flow's own updates.
  const prefs = await getUserPrefs(userKey);
  if (!prefs.informed) {
    if (replyTo) await sendWhatsApp(replyTo, WELCOME_MESSAGE);
    prefs.informed = true;
    await saveUserPrefs(userKey, prefs);
  }

  const flow = getFlow('songOnDemand');
  if (!flow) {
    return NextResponse.json({ error: 'songOnDemand flow missing' }, { status: 500 });
  }

  const session = createSession({
    to: phone,
    flow: 'songOnDemand',
    params: { query, replyTo, userKey },
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
