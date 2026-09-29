// The three things a newcomer does first, read from the server's graph so the checklist never disagrees with it.
import type { Graph } from './orchestrator';

export type FirstStep = { id: 'add' | 'connect' | 'run'; label: string; how: string; done: boolean };
export function firstSteps(graph: Pick<Graph, 'agents' | 'edges'>) {
  const steps: FirstStep[] = [
    { id: 'add', label: 'Add an agent', how: 'Add agent in the toolbar, or double-click empty canvas.', done: graph.agents.length >= 2 },
    { id: 'connect', label: 'Connect two agents', how: "Drag from a card's right dot to another card's left dot, or use Details → Connect.", done: graph.edges.length >= 1 },
    { id: 'run', label: 'Run an agent', how: 'Select an agent, type a message in its Run tab and press Send.', done: graph.agents.some(agent => agent.output.trim() !== '') },
  ];
  const done = steps.filter(step => step.done).length;
  return { steps, done, complete: done === steps.length };
}
