import { Circle, CircleCheck, CirclePause, LoaderCircle, OctagonX } from 'lucide-react';
import { agentStatuses, type StatusIcon } from '../lib/agent-status';
import type { Status } from '../lib/orchestrator';
import { cn } from '../lib/utils';

const icons: Record<StatusIcon, typeof Circle> = { ready: Circle, running: LoaderCircle, completed: CircleCheck, paused: CirclePause, blocked: OctagonX };
export function AgentStatusBadge({ status, className }: { status: Status; className?: string }) {
  const { label, tone, icon } = agentStatuses[status];
  const Icon = icons[icon];
  return <span className={cn('status', `tone-${tone}`, className)}><Icon size={14} aria-hidden="true" />{label}</span>;
}
