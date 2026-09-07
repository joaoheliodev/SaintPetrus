'use client';
import React, { useEffect, useRef, useState } from 'react';
import { eventTypes, type BusEvent, type EventBatch } from '../lib/events/types';
import { useProjection } from '../lib/store';
export function EventRow({ event, select }: { event: BusEvent; select: (id: string) => void }) {
  // React text interpolation only: event payload is never trusted HTML.
  return <button className="feed-row" onClick={() => select(event.agent_id)}><time>{event.timestamp}</time> · {event.severity} · {event.role} · {event.type} · {event.source && `${event.source} → ${event.destination ?? ''}`} {event.payload}</button>;
}
export function EventFeed() {
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [tokens, setTokens] = useState(0); const [connection, setConnection] = useState('Connecting');
  const [agent, setAgent] = useState(''); const [type, setType] = useState(''); const [severity, setSeverity] = useState('');
  const [paused, setPaused] = useState(false); const list = useRef<HTMLDivElement>(null);
  const select = useProjection(state => state.select); const agents = useProjection(state => state.graph.agents);
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('update', message => {
      const batch = JSON.parse((message as MessageEvent<string>).data) as EventBatch;
      setEvents(previous => [...new Map([...previous, ...batch.events].map(event => [event.id, event])).values()].sort((a, b) => b.id - a.id).slice(0, 500));
      setTokens(batch.prompt + batch.completion); setConnection(batch.truncated ? 'Live · older events expired' : 'Live · SSE');
    });
    source.onerror = () => setConnection('Reconnecting · SSE');
    return () => source.close();
  }, []);
  useEffect(() => { if (!paused && list.current) list.current.scrollTop = 0; }, [events, paused]);
  return <section className="event-feed" aria-label="Live event feed">
    <header><strong>{connection}</strong> · Accumulated tokens: {tokens} <button onClick={() => setPaused(!paused)}>{paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}</button></header>
    <p>Process-local history; restart clears it. Tokens include labeled mock estimates. Display retains up to 500 events.</p>
    <label>Filter agent<select value={agent} onChange={e => setAgent(e.target.value)}><option value="">All agents</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>Filter type<select value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{eventTypes.map(t => <option key={t}>{t}</option>)}</select></label>
    <label>Filter severity<select value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{['info', 'warning', 'error'].map(s => <option key={s}>{s}</option>)}</select></label>
    <div ref={list} className="feed-list" onWheel={() => setPaused(true)} onTouchMove={() => setPaused(true)} onScroll={e => { if (e.currentTarget.scrollTop > 0) setPaused(true); }}>
      {events.filter(e => (!agent || e.agent_id === agent) && (!type || e.type === type) && (!severity || e.severity === severity)).map(event => <EventRow key={event.id} event={event} select={select} />)}
    </div>
  </section>;
}
