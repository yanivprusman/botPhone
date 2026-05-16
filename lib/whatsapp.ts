const WHATSAPP_BRIDGE_URL = 'http://127.0.0.1:8080';

/**
 * Send a WhatsApp text message to a recipient via the local bridge. The
 * recipient should be either a JID ("972556677260@s.whatsapp.net") or a bare
 * digit-string phone number ("972556677260") — the bridge accepts either.
 *
 * Returns true on success, false on any HTTP/transport failure. Errors are
 * intentionally swallowed (logged only) because progress updates are best-
 * effort and must never break the conversation flow.
 */
export async function sendWhatsApp(recipient: string, message: string): Promise<boolean> {
  if (!recipient || !message) return false;
  try {
    const res = await fetch(`${WHATSAPP_BRIDGE_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, message }),
    });
    if (!res.ok) {
      console.error(`[whatsapp] send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[whatsapp] send transport error:', err);
    return false;
  }
}

/**
 * Convert a WhatsApp JID (e.g. "972556677260@s.whatsapp.net" or
 * "972556677260:42@s.whatsapp.net") to a local Israeli phone format
 * ("0556677260"). Falls back to the raw digits if it doesn't look Israeli.
 */
export function jidToPhone(jid: string): string | null {
  if (!jid) return null;
  // Strip device suffix and @domain
  const atIdx = jid.indexOf('@');
  let id = atIdx >= 0 ? jid.slice(0, atIdx) : jid;
  const colonIdx = id.indexOf(':');
  if (colonIdx >= 0) id = id.slice(0, colonIdx);
  // Now id is a string of digits (country code + number, no +).
  if (!/^\d+$/.test(id)) return null;
  // Israeli mobile: 972 + 9 digits starting with 5 (or 502 etc.). Convert to
  // local 10-digit format with leading 0.
  if (id.startsWith('972') && id.length === 12) {
    return '0' + id.slice(3);
  }
  // Unknown country code — return raw digits with a + so it's still dialable.
  return '+' + id;
}

/**
 * Parse a "play <song>" command from a WhatsApp message body. Case-insensitive,
 * accepts leading/trailing whitespace. Returns the song query string or null
 * if the message doesn't match the pattern.
 *
 * Examples:
 *   "play tom petty free fallin"   → "tom petty free fallin"
 *   "Play שיר של עומר אדם"          → "שיר של עומר אדם"
 *   "hi"                            → null
 */
export function parsePlayCommand(content: string): string | null {
  if (!content) return null;
  const m = content.trim().match(/^play\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
