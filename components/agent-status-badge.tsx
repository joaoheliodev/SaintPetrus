import { Circle, CircleCheck, CirclePause, LoaderCircle, OctagonX } from 'lucide-react';
import { agentStatuses, type StatusIcon } from '../lib/agent-status';
import type { Status } from '../lib/orchestrator';
import { cn } from '../lib/utils';

const icons: Record<StatusIcon, typeof Circle> = { ready: Circle, running: LoaderCircle, completed: CircleCheck, paused: CirclePause, blocked: OctagonX };
// compact keeps the text for screen readers and the tooltip, where a list row has room only for the icon.
export function AgentStatusBadge({ status, className, compact = false }: { status: Status; className?: string; compact?: boolean }) {
  const { label, tone, icon } = agentStatuses[status];
  const Icon = icons[icon];
  return <span className={cn('status', `tone-${tone}`, className)} title={compact ? label : undefined}><Icon size={14} aria-hidden="true" />{compact ? <span className="sr-only">{label}</span> : label}</span>;
}
