import { execFile } from 'child_process';
import { promisify } from 'util';
import { sendCmdJSON } from '../daemon';
import type { CallSession, ConversationFlow, CallStage } from './types';

const execFileAsync = promisify(execFile);

function pushEvent(session: CallSession, stage: CallStage, detail?: string) {
  session.events.push({ ts: Date.now(), stage, detail });
}

/** Search YouTube for the song and download the audio. Returns wav path + title. */
async function downloadSong(query: string): Promise<{ path: string; title: string }> {
  const out = `/tmp/botphone-song-${Date.now()}.%(ext)s`;
  const resolved = out.replace('.%(ext)s', '.wav');
  const { stdout } = await execFileAsync(
    'yt-dlp',
    [
      `ytsearch1:${query}`,
      '-x',
      '--audio-format', 'wav',
      '--no-playlist',
      '-o', out,
      '--print', 'title',
      '--no-progress',
      '--remote-components', 'ejs:github',
      '--js-runtimes', 'node',
    ],
    { timeout: 180_000 },
  );
  const title = stdout.trim().split('\n')[0] || query;
  return { path: resolved, title };
}

export const songRequestFlow: ConversationFlow = {
  id: 'songRequest',
  name: 'Song Request',
  description: 'Calls the user, asks them to name a song, searches YouTube, and plays it.',

  async run(session) {
    try {
      // 1. Dial + greet. --noHangup keeps the call alive after the greeting
      //    so we can listen and play the song into the same call.
      pushEvent(session, 'dialing', `Calling ${session.to}`);
      pushEvent(session, 'greeting', 'Asking for a song name');
      await sendCmdJSON('botCall', {
        to: session.to,
        speech:
          "Hi! Please tell me the name of a song you would like to hear, " +
          "and I will play it for you. Speak when you are ready, then pause.",
        noHangup: true,
      }, 180_000);

      // 2. Listen for the caller's response.
      pushEvent(session, 'listening', 'Recording response (silence-detected end)');
      const listenOut = `/tmp/botphone-listen-${Date.now()}.wav`;
      await sendCmdJSON('botListen', {
        output: listenOut,
        maxSec: 12,
        silenceMs: 1800,
      }, 30_000);

      // 3. Transcribe.
      pushEvent(session, 'transcribing', 'Converting speech to text');
      const trans = await sendCmdJSON<{ text: string; engine: string }>('botTranscribe', {
        audio: listenOut,
        engine: 'gemini',  // autodetect handles Hebrew + English
      }, 30_000);
      const songQuery = trans.text.trim();
      session.transcript = songQuery;
      pushEvent(session, 'transcribing', `Heard: "${songQuery}"`);
      if (!songQuery) throw new Error('No speech detected');

      // 4. Search YouTube + download.
      pushEvent(session, 'searching', `Searching YouTube for "${songQuery}"`);
      const { path: songPath, title } = await downloadSong(songQuery);
      session.songTitle = title;
      pushEvent(session, 'searching', `Found: ${title}`);

      // 5. Play the song into the call.
      // (Future: optional pre-play announcement once botPlay supports --speech)
      pushEvent(session, 'playing', `Playing: ${title}`);
      await sendCmdJSON('botPlay', { audio: songPath }, 300_000);

      // 6. Hang up.
      pushEvent(session, 'hangingUp');
      await sendCmdJSON('botHangup', {}, 5_000);
      pushEvent(session, 'done');
    } catch (err) {
      session.error = err instanceof Error ? err.message : String(err);
      pushEvent(session, 'failed', session.error);
      // Best-effort hangup so we don't leave a stuck call
      try {
        await sendCmdJSON('botHangup', {}, 5_000);
      } catch { /* ignore */ }
    } finally {
      session.done = true;
      session.finishedAt = Date.now();
    }
  },
};
