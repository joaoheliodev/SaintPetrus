// How an agent's status and place in the graph are named on screen. One vocabulary for cards, lists and panels.
import type { Agent, Status } from './orchestrator';

export type StatusTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';
export type StatusIcon = 'ready' | 'running' | 'completed' | 'paused' | 'blocked';
// Each status has its own text and icon as well as a colour, so it never depends on colour alone.
export const agentStatuses: Record<Status, { label: string; tone: StatusTone; icon: StatusIcon }> = {
  ready: { label: 'Ready', tone: 'neutral', icon: 'ready' },
  running: { label: 'Running', tone: 'blue', icon: 'running' },
  completed: { label: 'Completed', tone: 'green', icon: 'completed' },
  paused: { label: 'Paused', tone: 'amber', icon: 'paused' },
  blocked: { label: 'Blocked', tone: 'red', icon: 'blocked' },
};

export type AgentRole = 'Coordinator' | 'Agent' | 'Subagent';
// The coordinator is the graph's fixed root, whatever it is named; a parent makes a subagent.
export const agentRole = (agent: Pick<Agent, 'id' | 'parentId'>): AgentRole => agent.id === 'root' ? 'Coordinator' : agent.parentId ? 'Subagent' : 'Agent';
export const agentPlacement = (agent: Pick<Agent, 'id' | 'parentId' | 'depth'>) => `${agentRole(agent)} · level ${agent.depth}`;
