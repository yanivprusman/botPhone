import { execFile } from 'child_process';
import { promisify } from 'util';
import { sendCmdJSON } from '../daemon';
import { sendWhatsApp } from '../whatsapp';
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
      '/root/.local/bin/yt-dlp',
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
    // WhatsApp recipient to send progress updates back to. Set by the webhook
    // handler when the flow is triggered from WhatsApp. May be undefined for
    // UI-triggered flows — sendWhatsApp() is a no-op in that case.
    const reply = String(session.params.replyTo ?? '');
    const wa = async (msg: string) => {
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

      // Update 2/4: confirm what was found and that the call is coming.
      await wa(`Found: ${title}. Calling you now — pick up to hear it.`);

      // 2. Call + greet. --noHangup so we can inject the song after.
      const greet =
        "Hello! Someone has requested a song for you. " +
        `Now playing: ${title}.`;
      pushEvent(session, 'dialing', `Calling ${session.to}`);
      pushEvent(session, 'greeting', `Announcing: ${title}`);
      await sendCmdJSON('botCall', {
        to: session.to,
        speech: greet,
        noHangup: true,
      }, 180_000);

      // 3. Play the song into the active call.
      pushEvent(session, 'playing', `Playing: ${title}`);
      await sendCmdJSON('botPlay', { audio: songPath }, 600_000);

      // 4. Hang up.
      pushEvent(session, 'hangingUp');
      await sendCmdJSON('botHangup', {}, 5_000);
      pushEvent(session, 'done');

      // Update 3/4: done summary with duration.
      const duration = Date.now() - session.startedAt;
      await wa(`Done! Played "${title}" (${fmtDuration(duration)} total).`);

      // Update 4/4: the coffee joke.
      await wa("Buy me a coffee ☕ 15 NIS via Bit?");
    } catch (err) {
      session.error = err instanceof Error ? err.message : String(err);
      pushEvent(session, 'failed', session.error);
      // Reply with a friendly message rather than the raw exception text.
      if (session.error.includes('Call declined') ||
          session.error.includes('never answered')) {
        await wa("You didn't pick up — try again when you're ready.");
      } else if (session.error.includes('yt-dlp')) {
        await wa(`Sorry, couldn't find "${query}" on YouTube.`);
      } else {
        await wa(`Failed: ${session.error}`);
      }
      try { await sendCmdJSON('botHangup', {}, 5_000); } catch { /* ignore */ }
    } finally {
      session.done = true;
      session.finishedAt = Date.now();
    }
  },
};
