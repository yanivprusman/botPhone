import { execFile } from 'child_process';
import { promisify } from 'util';
import { sendCmdJSON } from '../daemon';
import type { CallSession, ConversationFlow, CallStage } from './types';

const execFileAsync = promisify(execFile);

function pushEvent(session: CallSession, stage: CallStage, detail?: string) {
  session.events.push({ ts: Date.now(), stage, detail });
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
    if (!query) {
      session.error = 'songOnDemand requires params.query';
      pushEvent(session, 'failed', session.error);
      session.done = true;
      session.finishedAt = Date.now();
      return;
    }
    session.transcript = query;

    try {
      // 1. Search YouTube + download FIRST. If the song doesn't exist or
      //    yt-dlp fails, we want to know before placing a call.
      pushEvent(session, 'searching', `Searching YouTube for "${query}"`);
      const { path: songPath, title } = await downloadSong(query);
      session.songTitle = title;
      pushEvent(session, 'searching', `Found: ${title}`);

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
    } catch (err) {
      session.error = err instanceof Error ? err.message : String(err);
      pushEvent(session, 'failed', session.error);
      try { await sendCmdJSON('botHangup', {}, 5_000); } catch { /* ignore */ }
    } finally {
      session.done = true;
      session.finishedAt = Date.now();
    }
  },
};
