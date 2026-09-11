import { isGraph, isGraphEvent, type GraphEvent } from './orchestrator';

export type GraphEventSource = {
  onopen: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent<string>) => unknown) | null;
  close: () => void;
};

type Options = {
  createSource: () => GraphEventSource;
  fetchSnapshot: (signal: AbortSignal) => Promise<unknown>;
  apply: (event: GraphEvent) => void;
  unavailable: (value: boolean) => void;
  pollMs?: number;
};

export function startGraphSync({ createSource, fetchSnapshot, apply, unavailable, pollMs = 300 }: Options) {
  let disposed = false; let fallback = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pollController: AbortController | undefined;
  let source: GraphEventSource | undefined;
  const stopPoll = () => { if (timer) clearTimeout(timer); timer = undefined; pollController?.abort(); pollController = undefined; };
  const schedulePoll = () => {
    if (disposed || !fallback || timer || pollController) return;
    timer = setTimeout(() => { timer = undefined; void poll(); }, pollMs);
  };
  const poll = async () => {
    if (disposed || !fallback) return;
    const controller = new AbortController(); pollController = controller;
    try {
      const snapshot = await fetchSnapshot(controller.signal);
      if (!isGraph(snapshot)) throw new Error('Invalid graph snapshot.');
      if (!disposed && fallback) {
        apply({ id: snapshot.revision, type: 'graph.updated', message: 'Fallback snapshot received.', snapshot });
        unavailable(false);
      }
    } catch { if (!disposed && fallback && !controller.signal.aborted) unavailable(true); }
    finally { if (pollController === controller) pollController = undefined; schedulePoll(); }
  };
  const streamReady = () => { fallback = false; stopPoll(); unavailable(false); };
  const streamFailed = () => { if (disposed) return; fallback = true; unavailable(true); schedulePoll(); };
  try {
    source = createSource();
    source.onopen = streamReady;
    source.onerror = streamFailed;
    source.onmessage = event => {
      try {
        const update: unknown = JSON.parse(event.data);
        if (!isGraphEvent(update)) throw new Error('Invalid graph event.');
        apply(update); streamReady();
      } catch { streamFailed(); }
    };
  } catch { streamFailed(); }
  return () => {
    disposed = true; fallback = false; stopPoll();
    if (source) { source.onopen = null; source.onerror = null; source.onmessage = null; source.close(); }
  };
}
