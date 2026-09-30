'use client';
import React, { useEffect, useRef, useState } from 'react';
import { eventTypes, type BusEvent, type EventWindow } from '../lib/events/types';
import { useProjection } from '../lib/store';
import { busLine } from '../lib/activity-log';
import { hiddenAfterWindow, hiddenWhenCleared, shownFeedLines } from '../lib/cleared-history';
import { useNow } from './activity-log';
export function EventRow({ event, select, now }: { event: BusEvent; select: (id: string) => void; now?: number }) {
  const line = busLine(event, now ?? Date.parse(event.timestamp));
  // React text interpolation only: event payload is never trusted HTML.
  return <button className="feed-row" onClick={() => select(event.agent_id)}><time className="activity-time" dateTime={event.timestamp} title={event.timestamp}>{now === undefined ? event.timestamp : line.time}</time><span className="activity-title"><strong>{line.agent}</strong> · {line.title}{event.severity === 'info' ? '' : ` · ${event.severity}`}</span><span className="activity-detail">⎿ {line.detail}</span></button>;
}
export const replaceEventWindow = (_previous: readonly BusEvent[], window: EventWindow) => window.events;
// The server's window as delivered, and the newest line received before a configured key cleared the history.
export type FeedState = { events: BusEvent[]; hiddenThrough: number };
export const feedAfterWindow = (current: FeedState, window: EventWindow): FeedState => ({ events: replaceEventWindow(current.events, window), hiddenThrough: hiddenAfterWindow(current.hiddenThrough, window.cursor) });
// Each clearing the projection counts hides what the feed has received so far; the returned function stops following.
export function followClearings(update: (next: (current: FeedState) => FeedState) => void) {
  return useProjection.subscribe((state, previous) => { if (state.clearings !== previous.clearings) update(current => ({ ...current, hiddenThrough: hiddenWhenCleared(current.events) })); });
}
// The list: the window as delivered, less the lines a clearing hid, through the viewer's filters.
export function FeedLines({ feed, matches, select, now }: { feed: FeedState; matches: (event: BusEvent) => boolean; select: (id: string) => void; now?: number }) {
  const events = shownFeedLines(feed.events, feed.hiddenThrough); const visible = events.filter(matches);
  return <>{visible.map(event => <EventRow key={event.id} event={event} select={select} now={now} />)}
    {visible.length === 0 && <p>{events.length ? 'No events match these filters.' : feed.hiddenThrough ? 'No events since a key was configured.' : 'No events yet.'}</p>}</>;
}
export function EventFeed() {
  const [feed, setFeed] = useState<FeedState>({ events: [], hiddenThrough: 0 });
  const [tokens, setTokens] = useState(0); const [connection, setConnection] = useState('Connecting');
  const [agent, setAgent] = useState(''); const [type, setType] = useState(''); const [severity, setSeverity] = useState('');
  const [paused, setPaused] = useState(false); const list = useRef<HTMLDivElement>(null);
  const now = useNow();
  const select = useProjection(state => state.select); const agents = useProjection(state => state.graph.agents);
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.addEventListener('update', message => {
      const batch = JSON.parse((message as MessageEvent<string>).data) as EventWindow;
      setFeed(current => feedAfterWindow(current, batch));
      setTokens(batch.prompt + batch.completion); setConnection(batch.truncated ? 'Live · older events expired' : 'Live · SSE');
    });
    source.onerror = () => setConnection('Reconnecting · SSE');
    return () => source.close();
  }, []);
  useEffect(() => followClearings(setFeed), []);
  useEffect(() => { if (!paused && list.current) list.current.scrollTop = 0; }, [feed, paused]);
  return <section className="event-feed" aria-label="Live event feed">
    <h2>Live event feed</h2>
    <header><strong>{connection}</strong> · Accumulated tokens: {tokens} <button onClick={() => setPaused(!paused)}>{paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}</button></header>
    <p>Process-local history; restart clears it. Tokens include labeled mock estimates. The server owns the retained event window.</p>
    <label>Filter agent<select value={agent} onChange={e => setAgent(e.target.value)}><option value="">All agents</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <label>Filter type<select value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{eventTypes.map(t => <option key={t}>{t}</option>)}</select></label>
    <label>Filter severity<select value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{['info', 'warning', 'error'].map(s => <option key={s}>{s}</option>)}</select></label>
    <div ref={list} className="feed-list" onWheel={() => setPaused(true)} onTouchMove={() => setPaused(true)} onScroll={e => { if (e.currentTarget.scrollTop > 0) setPaused(true); }}>
      <FeedLines feed={feed} matches={e => (!agent || e.agent_id === agent) && (!type || e.type === type) && (!severity || e.severity === severity)} select={select} now={now} />
    </div>
  </section>;
}
