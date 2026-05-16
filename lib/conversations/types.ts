export type CallStage =
  | 'dialing'
  | 'greeting'
  | 'listening'
  | 'transcribing'
  | 'searching'
  | 'playing'
  | 'hangingUp'
  | 'done'
  | 'failed';

export interface CallEvent {
  ts: number;
  stage: CallStage;
  detail?: string;
}

export interface CallSession {
  id: string;
  to: string;
  flow: string;
  /** Free-form flow inputs (e.g. {query: "tom petty free fallin'"}). */
  params: Record<string, unknown>;
  /** Where this session was triggered from (UI, whatsapp, etc.) for analytics. */
  source: 'ui' | 'whatsapp' | 'api';
  events: CallEvent[];
  transcript?: string;
  songUrl?: string;
  songTitle?: string;
  error?: string;
  done: boolean;
  startedAt: number;
  finishedAt?: number;
}

export interface ConversationFlow {
  /** Stable id used in the UI/API */
  id: string;
  /** Human-readable name shown in the flow picker */
  name: string;
  /** Description of what the flow does */
  description: string;
  /** Run the flow end-to-end. Mutates the passed session with events. */
  run(session: CallSession): Promise<void>;
}
