import { execFile } from 'child_process';
import { promisify } from 'util';
import { NextRequest, NextResponse } from 'next/server';
import { createSession } from '@/lib/sessionStore';
import { getFlow } from '@/lib/conversations';
import { jidToPhone, parsePlayCommand, sendWhatsApp } from '@/lib/whatsapp';
import { getUserPrefs, saveUserPrefs } from '@/lib/users';

const execFileAsync = promisify(execFile);

/** Expected WhatsApp number the bridge MUST be logged in as. Anything else
 *  is rejected so messages to the user's personal WhatsApp don't get hijacked
 *  into placing calls. Override via BOT_WHATSAPP_NUMBER env. */
const EXPECTED_BOT_NUMBER = process.env.BOT_WHATSAPP_NUMBER || '972559448186';

let cachedBridgeNumber: string | null = null;
let bridgeNumberCheckedAt = 0;

/** Read the bridge's own JID from its SQLite store. Cached for 60s to avoid
 *  hammering the DB on every webhook hit. */
async function getBridgeOwnNumber(): Promise<string | null> {
  if (cachedBridgeNumber && Date.now() - bridgeNumberCheckedAt < 60_000) {
    return cachedBridgeNumber;
  }
  try {
    // Bot bridge DB lives under whatsapp-bridge-bot/store/ — separate from the
    // personal-account bridge so we don't accidentally trust the personal JID.
    const { stdout } = await execFileAsync('sqlite3', [
      '/opt/automateLinux/mcpServers/whatsapp/whatsapp-bridge-bot/store/whatsapp.db',
      'SELECT jid FROM whatsmeow_device LIMIT 1;',
    ], { timeout: 3_000 });
    const jid = stdout.trim();
    if (!jid) return null;
    const digits = jid.split('@')[0].split(':')[0].replace(/[^\d]/g, '');
    cachedBridgeNumber = digits;
    bridgeNumberCheckedAt = Date.now();
    return digits;
  } catch (err) {
    console.error('[webhook] failed to read bridge JID:', err);
    return null;
  }
}

const WELCOME_MESSAGE =
  "Hi! I'm a bot 🤖 — not a person. " +
  "When you send `play <song>`, I'll search YouTube and call you back to play it.\n\n" +
  "Example: `play tom petty free fallin'`\n\n" +
  "I'll send you updates — you can stop them any time, send `no updates`.";

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
  // SAFETY: refuse to do anything unless the bridge is logged in as the
  // expected bot WhatsApp number. Otherwise we'd be hijacking the user's
  // personal WhatsApp account (whoever messages them gets called back).
  const bridgeNumber = await getBridgeOwnNumber();
  if (!bridgeNumber) {
    console.error('[webhook] cannot determine bridge own number — refusing');
    return NextResponse.json({ error: 'bridge identity unknown' }, { status: 503 });
  }
  if (bridgeNumber !== EXPECTED_BOT_NUMBER) {
    console.error(
      `[webhook] REFUSED: bridge logged in as ${bridgeNumber}, expected ${EXPECTED_BOT_NUMBER}. ` +
      `Re-pair the bridge with the bot WhatsApp account.`,
    );
    return NextResponse.json({
      error: 'bridge logged in to wrong account',
      bridgeNumber,
      expected: EXPECTED_BOT_NUMBER,
    }, { status: 412 });
  }

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

  // First-time user? Send the welcome on ANY message (not just play commands).
  const prefs = await getUserPrefs(userKey);
  if (!prefs.informed && replyTo && isDirectChat(body.chatJID)) {
    await sendWhatsApp(replyTo, WELCOME_MESSAGE);
    prefs.informed = true;
    await saveUserPrefs(userKey, prefs);
  }

  const query = parsePlayCommand(content);
  if (!query) {
    // Wrong format — send a usage hint, but only in direct chats (no groups).
    if (replyTo && isDirectChat(body.chatJID) && content.length > 0 && prefs.informed) {
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
