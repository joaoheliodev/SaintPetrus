// The canvas survives a restart (operator decision Q-04). Accounting has its own journal (lib/tokens/accounting-journal.ts).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphError, type GraphService } from './graph-service';
import { parseGraphDocument } from './graph-document';
import { safeStringify } from '../security/redact';
import type { GraphPersistence } from '../graph-persistence';

export type GraphRestore = { restored: boolean; rejectedAs?: string };

// A fixed sentence: the file system's own error can carry a path, and a path is not for the panel.
export const GRAPH_UNWRITABLE = 'The graph could not be written to the user data directory; the next change tries again.';

export class GraphStore {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: { snapshot: unknown } | undefined;
  private state: GraphPersistence = { saving: true };
  constructor(private readonly directory: string, private readonly warn: (message: string) => void = () => {}, private readonly delayMs = 250, private readonly now: () => number = Date.now) {}
  get file() { return join(this.directory, 'graph.json'); }
  // A saved file is read through the same strict parser as an import: the store is not more trusted than a file.
  // An unreadable one is set aside, never overwritten, so nothing the operator saved is lost.
  restore(graph: GraphService, now = new Date()): GraphRestore {
    if (!existsSync(this.file)) return { restored: false };
    try { graph.replace(parseGraphDocument(readFileSync(this.file, 'utf8')), 'restored'); return { restored: true }; }
    catch {
      const rejectedAs = join(this.directory, `graph-rejected-${now.toISOString().replace(/[:.]/g, '-')}.json`);
      renameSync(this.file, rejectedAs);
      return { restored: false, rejectedAs };
    }
  }
  // Whether the file keeps up with the graph, for GET /api/graph/persistence; the panel warns while it does not.
  persistence(): GraphPersistence { return { ...this.state }; }
  // Mock output emits a change per character, so writes are coalesced; the newest snapshot always wins.
  attach(graph: GraphService) {
    this.schedule(graph.snapshot());
    return graph.subscribe(event => this.schedule(event.snapshot));
  }
  private schedule(snapshot: unknown) {
    this.pending = { snapshot };
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      try { this.flush(); } catch { this.warn('The graph could not be saved; the next change tries again.'); }
    }, this.delayMs);
  }
  // since is when saving stopped, kept while the reason changes: the changes at risk are the ones made after it.
  private notSaving(reason: string) {
    this.state = { saving: false, reason, since: this.state.saving ? this.now() : this.state.since };
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    const pending = this.pending; this.pending = undefined;
    if (pending === undefined) return;
    // Redacted at write time, like the export, so a key configured since the change never reaches the disk.
    const text = safeStringify(pending.snapshot);
    // Never write what the restore would refuse: the last valid file stays, and the operator is told once per reason.
    try { parseGraphDocument(text); }
    catch (error) {
      // Only the parser's own sentence, which names the field and never repeats the text it refused.
      const reason = GraphError.is(error) ? error.message : 'Graph file refused.';
      if (this.state.saving || this.state.reason !== reason) this.warn(`The graph was not saved, and the last valid copy is kept. ${reason}`);
      this.notSaving(reason); return;
    }
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 }); chmodSync(this.directory, 0o700);
      // Written beside the file and renamed over it, so a crash leaves the old graph or the new one, never half of one.
      const partial = `${this.file}.partial`;
      writeFileSync(partial, text, { mode: 0o600 }); chmodSync(partial, 0o600);
      renameSync(partial, this.file);
    } catch (error) { this.notSaving(GRAPH_UNWRITABLE); throw error; }
    this.state = { saving: true };
  }
}
