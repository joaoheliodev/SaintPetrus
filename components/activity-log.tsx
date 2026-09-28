'use client';
import { useEffect, useState } from 'react';
import { graphLine, isNoise, type ActivityLine } from '../lib/activity-log';
import type { ReceivedEvent } from '../lib/store';

// A clock for "2m ago" labels; it only re-renders, it never reorders or refetches anything.
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}
// Text only: titles, agent names and details come from the server and are never rendered as HTML.
export function ActivityLines({ lines }: { lines: ActivityLine[] }) {
  return <ol className="activity-lines">{lines.map(line => <li key={line.key}>
    <span className="activity-time">{line.time}</span><span className="activity-title">{line.agent ? <><strong>{line.agent}</strong> · </> : null}{line.title}</span>
    {line.detail && <span className="activity-detail">⎿ {line.detail}</span>}
  </li>)}</ol>;
}
export function GraphActivity({ events, revision }: { events: readonly ReceivedEvent[]; revision: number }) {
  const [noise, setNoise] = useState(false); const now = useNow();
  const shown = events.filter(event => noise || !isNoise(event.type));
  const hidden = events.length - shown.length;
  return <section className="activity" aria-label="Graph events">
    <div className="activity-bar"><label className="checkbox-row"><input type="checkbox" checked={noise} onChange={event => setNoise(event.target.checked)} />Show card moves and demo output{hidden ? ` (${hidden} hidden)` : ''}</label><small>revision {revision}</small></div>
    {shown.length ? <ActivityLines lines={shown.map(event => graphLine(event, now))} /> : <p className="helper">{events.length ? 'Only card moves and demo output since this page opened.' : 'No changes since this page opened. Earlier work is on the canvas; the log starts when the page loads.'}</p>}
  </section>;
}
