import type { ConversationFlow } from './types';
import { songRequestFlow } from './songRequest';

export const flows: Record<string, ConversationFlow> = {
  [songRequestFlow.id]: songRequestFlow,
};

export function getFlow(id: string): ConversationFlow | undefined {
  return flows[id];
}

export function listFlows() {
  return Object.values(flows).map((f) => ({
    id: f.id,
    name: f.name,
    description: f.description,
  }));
}
