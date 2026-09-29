import { redactText } from '../security/redact';
export type ArtifactVersion = { id: number; agent_id: string; role: string; source: string; timestamp: string };
export const previewEnabled = () => process.env.SAINTPETRUS_PREVIEW === 'true';
export function visualSource(text: string): string | undefined {
  const blocks = [...text.matchAll(/```(html|css|javascript|js)\s*\n([\s\S]*?)(?:```|$)/g)];
  if (!blocks.length) return /^\s*(?:<!doctype html|<html|<div|<style|<body)/i.test(text) ? text : undefined;
  return blocks.map(([, language, code]) => language === 'css' ? `<style>${code}</style>` : language === 'js' || language === 'javascript' ? `<script>${code}</script>` : code).join('\n');
}
export class ArtifactStore {
  private versions: ArtifactVersion[] = []; private cursor = 0;
  private listeners = new Set<() => void>();
  private pending = new Map<string, { timer: ReturnType<typeof setTimeout>; source: string; role: string }>();
  snapshot() { return structuredClone(this.versions); }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  update(agent_id: string, role: string, text: string) {
    // Redaction occurs before parsing, trimming, storage or client exposure.
    const source = visualSource(redactText(text)); if (source === undefined || source.length > 100000) return;
    const existing = this.pending.get(agent_id);
    if (existing) { existing.source = source; existing.role = role; return; }
    const timer = setTimeout(() => { const latest = this.pending.get(agent_id); this.pending.delete(agent_id); if (latest) this.append(agent_id, latest.role, latest.source); }, 250);
    this.pending.set(agent_id, { timer, source, role });
  }
  flush() { for (const [id, item] of this.pending) { clearTimeout(item.timer); this.append(id, item.role, item.source); } this.pending.clear(); }
  private append(agent_id: string, role: string, source: string) {
    if (this.versions[0]?.source === source && this.versions[0]?.agent_id === agent_id) return;
    this.versions.unshift({ id: ++this.cursor, agent_id: redactText(agent_id), role: redactText(role), source, timestamp: new Date().toISOString() });
    this.versions.length = Math.min(20, this.versions.length);
    for (const listener of this.listeners) { try { listener(); } catch { /* Consumer isolation. */ } }
  }
}
const state = globalThis as typeof globalThis & { saintpetrusArtifacts?: ArtifactStore };
export const artifacts = () => state.saintpetrusArtifacts ??= new ArtifactStore();
export function observeArtifact(id: string, role: string, text: string) { if (previewEnabled()) artifacts().update(id, role, text); }
