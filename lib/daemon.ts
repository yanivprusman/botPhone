import net from 'net';

const UDS_PATH = '/run/automatelinux/automatelinux-daemon.sock';

/** Send one command to the daemon via UNIX socket. Returns the raw response string.
 *  Long-running commands (botCall, botListen, botPlay) need a generous timeout. */
export function sendCmd(
  command: string,
  args: Record<string, string | number | boolean> = {},
  timeoutMs = 120_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload: Record<string, unknown> = { command };
    for (const [k, v] of Object.entries(args)) payload[k] = v;
    const client = net.createConnection(UDS_PATH);
    let response = '';
    let done = false;
    const finish = (fn: (val: unknown) => void, val: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.destroy();
      fn(val);
    };
    client.on('connect', () => { client.write(JSON.stringify(payload) + '\n'); });
    client.on('data', (d) => { response += d.toString(); if (response.endsWith('\n')) finish(resolve, response.trim()); });
    client.on('error', (err) => finish(reject, err));
    client.on('close', () => finish(resolve, response.trim()));
    const timer = setTimeout(
      () => finish(reject, new Error(`Daemon ${command} timeout after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
}

/** Send a command and parse the JSON response. Throws on non-JSON or {error: ...}. */
export async function sendCmdJSON<T = Record<string, unknown>>(
  command: string,
  args: Record<string, string | number | boolean> = {},
  timeoutMs = 120_000,
): Promise<T> {
  const raw = await sendCmd(command, args, timeoutMs);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Daemon ${command} returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (parsed && typeof parsed === 'object' && 'error' in parsed) {
    throw new Error(`Daemon ${command} error: ${parsed.error}`);
  }
  return parsed as T;
}
