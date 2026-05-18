import { execFile } from 'child_process';
import { promisify } from 'util';
import { sendWhatsApp, sendWhatsAppMedia } from '../whatsapp';
import { getUserPrefs, saveUserPrefs, isCoffeeDue } from '../users';
import type { CallSession, ConversationFlow, CallStage } from './types';

const execFileAsync = promisify(execFile);

function pushEvent(session: CallSession, stage: CallStage, detail?: string) {
  session.events.push({ ts: Date.now(), stage, detail });
}

/** Format ms duration as "M:SS". */
function fmtDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Transcode a WAV to OGG Opus so WhatsApp renders it as a playable audio
 *  message (the bridge classifies .ogg → audio/ogg opus). Returns the new
 *  path, or null on failure. */
async function toOggOpus(wavPath: string): Promise<string | null> {
  const oggPath = wavPath.replace(/\.wav$/i, '.ogg');
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', wavPath,
      '-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on',
      oggPath,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    return oggPath;
  } catch (err) {
    console.error('[songOnDemand] ffmpeg opus encode failed:', err);
    return null;
  }
}

async function downloadSong(query: string): Promise<{ path: string; title: string }> {
  const ts = Date.now();
  const out = `/tmp/botphone-song-${ts}.%(ext)s`;
  const resolved = `/tmp/botphone-song-${ts}.wav`;
  const logFile = `/tmp/botphone-yt-${ts}.log`;
  const { writeFileSync } = await import('fs');
  let stdout = '';
  let stderr = '';
  try {
    const r = await execFileAsync(
      'yt-dlp',
      [
        `ytsearch1:${query}`,
        '-x',
        '--audio-format', 'wav',
        '--no-playlist',
        '-o', out,
        '--print', 'after_move:filepath',
        '--print', 'title',
        '--no-progress',
        '--remote-components', 'ejs:github',
        '--js-runtimes', 'node',
      ],
      { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
    );
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (err) {
    // execFile throws on non-zero exit but still gives us stdout/stderr.
    const e = err as { stdout?: string; stderr?: string; message?: string };
    stdout = e.stdout ?? '';
    stderr = e.stderr ?? '';
    writeFileSync(logFile, `EXIT_ERR: ${e.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`);
    throw new Error(`yt-dlp failed: see ${logFile}`);
  }
  writeFileSync(logFile, `STDOUT:\n${stdout}\nSTDERR:\n${stderr}\n`);
  const lines = stdout.trim().split('\n').filter(Boolean);
  // --print after_move:filepath gives the actual path; title is on a separate line.
  const actualPath = lines.find((l) => l.startsWith('/tmp/')) ?? resolved;
  const title = lines.find((l) => !l.startsWith('/tmp/')) ?? query;
  return { path: actualPath, title };
}

/**
 * Variant of songRequest where the song name is already known (e.g. supplied
 * via WhatsApp message "play X"). Skips the listen + transcribe steps and
 * goes straight to download + play.
 */
export const songOnDemandFlow: ConversationFlow = {
  id: 'songOnDemand',
  name: 'Song on Demand',
  description: 'Calls the user and plays a song whose name is already known (no listen step).',

  async run(session) {
    const query = String(session.params.query ?? '').trim();
    // WhatsApp recipient + user key. replyTo is the chat JID we send into;
    // userKey is the sender JID we use to look up prefs (informed/optOut/coffee).
    const reply = String(session.params.replyTo ?? '');
    const userKey = String(session.params.userKey ?? reply);
    const prefs = userKey ? await getUserPrefs(userKey) : null;
    const updatesMuted = !!prefs?.optOut;
    // wa() = send a progress update; no-op when the user opted out.
    const wa = async (msg: string) => {
      if (reply && !updatesMuted) await sendWhatsApp(reply, msg);
    };
    // waAlways() = bypass the opt-out gate. Reserved for the yearly coffee
    // nudge so opted-out users get exactly one nudge per 365 days.
    const waAlways = async (msg: string) => {
      if (reply) await sendWhatsApp(reply, msg);
    };

    if (!query) {
      session.error = 'songOnDemand requires params.query';
      pushEvent(session, 'failed', session.error);
      session.done = true;
      session.finishedAt = Date.now();
      return;
    }
    session.transcript = query;

    try {
      // Update 1/4: acknowledge the request immediately so the user knows
      // their message was understood.
      await wa(`Got it. Searching for "${query}"...`);

      // 1. Search YouTube + download FIRST. If the song doesn't exist or
      //    yt-dlp fails, we want to know before placing a call.
      pushEvent(session, 'searching', `Searching YouTube for "${query}"`);
      const { path: songPath, title } = await downloadSong(query);
      session.songTitle = title;
      pushEvent(session, 'searching', `Found: ${title}`);

      // Update 2: confirm found + send the song via WhatsApp.
      await wa(`Found: ${title}. Sending it your way...`);

      // Send the full-quality audio as a WhatsApp audio message. Bypasses
      // the opt-out gate: this is the requested content, not a progress
      // update. Phone call path is currently disabled — keep botCall code
      // alive in this file but skip invoking it for now.
      if (!reply) {
        throw new Error('No WhatsApp reply target — cannot deliver song.');
      }
      const oggPath = await toOggOpus(songPath);
      if (!oggPath) {
        throw new Error('Failed to transcode song to OGG Opus.');
      }
      pushEvent(session, 'playing', `Sending: ${title}`);
      const sent = await sendWhatsAppMedia(reply, oggPath, title);
      if (!sent) {
        throw new Error('Failed to send the song over WhatsApp.');
      }
      pushEvent(session, 'done');

      // Done summary with duration.
      const duration = Date.now() - session.startedAt;
      await wa(`Done! Sent "${title}" — ${fmtDuration(duration)}.`);

      // Update 4/4: coffee nudge. Sent to everyone if updates are on; if
      // opted out, only once per 365 days so the user isn't completely
      // spammed but isn't fully forgotten either.
      if (prefs && userKey && isCoffeeDue(prefs)) {
        if (updatesMuted) {
          await waAlways(
            "Buy me a coffee ☕ 15 NIS via Bit? " +
            "(You're muted from progress updates — send `updates on` to re-enable.)",
          );
        } else {
          await wa("Buy me a coffee ☕ 15 NIS via Bit?");
        }
        prefs.lastCoffeeAt = Date.now();
        await saveUserPrefs(userKey, prefs);
      }
    } catch (err) {
      session.error = err instanceof Error ? err.message : String(err);
      pushEvent(session, 'failed', session.error);
      if (session.error.includes('yt-dlp')) {
        await wa(`Sorry, couldn't find "${query}" on YouTube.`);
      } else {
        await wa(`Failed: ${session.error}`);
      }
    } finally {
      session.done = true;
      session.finishedAt = Date.now();
    }
  },
};
