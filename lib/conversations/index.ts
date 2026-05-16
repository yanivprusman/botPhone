import type { ConversationFlow } from './types';
import { songRequestFlow } from './songRequest';
import { songOnDemandFlow } from './songOnDemand';

export const flows: Record<string, ConversationFlow> = {
  [songRequestFlow.id]: songRequestFlow,
  [songOnDemandFlow.id]: songOnDemandFlow,
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
