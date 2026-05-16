'use client';

import { useEffect, useRef, useState } from 'react';
import type { CallSession, CallStage } from '@/lib/conversations/types';

interface FlowDescriptor {
  id: string;
  name: string;
  description: string;
}

const STAGE_ORDER: CallStage[] = [
  'dialing',
  'greeting',
  'listening',
  'transcribing',
  'searching',
  'playing',
  'hangingUp',
  'done',
];

const STAGE_LABEL: Record<CallStage, string> = {
  dialing: 'Dialing',
  greeting: 'Greeting',
  listening: 'Listening',
  transcribing: 'Transcribing',
  searching: 'Searching YouTube',
  playing: 'Playing song',
  hangingUp: 'Hanging up',
  done: 'Done',
  failed: 'Failed',
};

export default function Home() {
  const [flows, setFlows] = useState<FlowDescriptor[]>([]);
  const [flowId, setFlowId] = useState<string>('songRequest');
  const [to, setTo] = useState<string>('0556677260');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/flows')
      .then((r) => r.json())
      .then((d) => setFlows(d.flows ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      try {
        const r = await fetch(`/api/call/${sessionId}`);
        if (r.ok) {
          const s: CallSession = await r.json();
          setSession(s);
          if (s.done && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // ignore transient errors during polling
      }
    };
    void poll();
    pollRef.current = setInterval(poll, 700);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [sessionId]);

  async function startCall() {
    if (starting || !to.trim()) return;
    setStarting(true);
    setSession(null);
    setSessionId(null);
    try {
      const r = await fetch('/api/call/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), flow: flowId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'start failed');
      setSessionId(d.sessionId);
    } catch (err) {
      alert(`Start failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setStarting(false);
    }
  }

  const currentStage = session?.events[session.events.length - 1]?.stage;
  const isFailed = session?.events.some((e) => e.stage === 'failed');

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6 max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold flex items-center gap-3">
          <span aria-hidden>📞</span>
          <span>botPhone</span>
        </h1>
        <p className="text-zinc-400 text-sm mt-1">
          Place a phone call from your Note 20 and run a conversation flow with the recipient.
        </p>
      </header>

      <section className="space-y-4 mb-8">
        <div>
          <label className="block text-sm text-zinc-400 mb-1" htmlFor="flow">Flow</label>
          <select
            id="flow"
            data-id="flow-picker"
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm"
            value={flowId}
            onChange={(e) => setFlowId(e.target.value)}
          >
            {flows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          {flows.find((f) => f.id === flowId)?.description && (
            <p className="text-xs text-zinc-500 mt-1">
              {flows.find((f) => f.id === flowId)!.description}
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1" htmlFor="to">Phone number</label>
          <input
            id="to"
            data-id="phone-input"
            type="tel"
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm font-mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0556677260"
          />
        </div>
        <button
          data-id="start-call"
          onClick={startCall}
          disabled={starting || !to.trim() || (sessionId !== null && !session?.done)}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-white font-medium rounded px-4 py-2.5 cursor-pointer transition-colors"
        >
          {starting ? 'Starting…' : (sessionId !== null && !session?.done) ? 'In progress…' : 'Start call'}
        </button>
      </section>

      {session && (
        <section className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-4" data-id="session-panel">
          <div className="flex items-baseline justify-between">
            <h2 className="font-medium">Call in progress</h2>
            <code className="text-xs text-zinc-500">{session.id}</code>
          </div>

          <ol className="space-y-1.5">
            {STAGE_ORDER.map((stage) => {
              const idxCurrent = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;
              const idxThis = STAGE_ORDER.indexOf(stage);
              const reached = idxThis <= idxCurrent;
              const isCurrent = stage === currentStage && !session.done;
              const colorClass = isFailed && reached ? 'text-red-400' : reached ? 'text-emerald-400' : 'text-zinc-600';
              return (
                <li key={stage} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${reached ? (isFailed ? 'bg-red-400' : 'bg-emerald-400') : 'bg-zinc-700'} ${isCurrent ? 'animate-pulse' : ''}`} />
                  <span className={colorClass}>{STAGE_LABEL[stage]}</span>
                </li>
              );
            })}
          </ol>

          {session.transcript && (
            <div data-id="transcript">
              <div className="text-xs text-zinc-500 mb-0.5">Heard from caller</div>
              <div className="text-sm bg-zinc-950 border border-zinc-800 rounded px-3 py-2 font-mono">
                {session.transcript}
              </div>
            </div>
          )}

          {session.songTitle && (
            <div data-id="song-title">
              <div className="text-xs text-zinc-500 mb-0.5">Now playing</div>
              <div className="text-sm bg-zinc-950 border border-zinc-800 rounded px-3 py-2">
                {session.songTitle}
              </div>
            </div>
          )}

          {session.error && (
            <div data-id="error" className="text-sm bg-red-950 border border-red-900 text-red-200 rounded px-3 py-2">
              {session.error}
            </div>
          )}

          <details className="text-xs">
            <summary className="text-zinc-500 cursor-pointer">Event log ({session.events.length})</summary>
            <ul className="mt-2 space-y-0.5 font-mono text-zinc-400">
              {session.events.map((ev, i) => (
                <li key={i}>
                  <span className="text-zinc-600">{new Date(ev.ts).toLocaleTimeString()}</span>{' '}
                  <span className="text-zinc-200">{ev.stage}</span>
                  {ev.detail && <span> — {ev.detail}</span>}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </main>
  );
}
