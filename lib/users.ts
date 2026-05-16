import { sendCmd } from './daemon';

// Per-user state for the WhatsApp bot, persisted via the daemon's KV entry
// store. Keyed by phone digits (no @, no +) so it's stable across JID format
// variations.

export interface UserPrefs {
  /** Have we sent the welcome / what-to-expect message to this user? */
  informed: boolean;
  /** True = user asked to mute progress updates. */
  optOut: boolean;
  /** Last time we sent the "buy me a coffee" message (ms since epoch).
   *  Used to ensure even opted-out users get one nudge per year. */
  lastCoffeeAt?: number;
}

const KEY_PREFIX = 'botPhone:user:';
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Extract just the digits portion of a JID or phone string. */
function keyForJid(jid: string): string {
  const atIdx = jid.indexOf('@');
  let id = atIdx >= 0 ? jid.slice(0, atIdx) : jid;
  const colonIdx = id.indexOf(':');
  if (colonIdx >= 0) id = id.slice(0, colonIdx);
  return id.replace(/[^\d]/g, '');
}

const DEFAULT_PREFS: UserPrefs = { informed: false, optOut: false };

export async function getUserPrefs(jid: string): Promise<UserPrefs> {
  const digits = keyForJid(jid);
  if (!digits) return { ...DEFAULT_PREFS };
  const key = KEY_PREFIX + digits;
  try {
    // d getEntry returns the raw stored string + newline; empty when missing.
    const raw = (await sendCmd('getEntry', { key }, 5_000)).trim();
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UserPrefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function saveUserPrefs(jid: string, prefs: UserPrefs): Promise<void> {
  const key = KEY_PREFIX + keyForJid(jid);
  try {
    await sendCmd('upsertEntry', { key, value: JSON.stringify(prefs) }, 5_000);
  } catch (err) {
    console.error('[users] saveUserPrefs failed:', err);
  }
}

/** Should we send the once-a-year coffee message to this user right now? */
export function isCoffeeDue(prefs: UserPrefs): boolean {
  if (!prefs.lastCoffeeAt) return true;
  return Date.now() - prefs.lastCoffeeAt >= YEAR_MS;
}
