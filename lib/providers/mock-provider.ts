// Explicit server-side test provider. Never imported by client components.
import { GraphService } from '../server/graph-service';
export class MockProvider {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private steps: (() => void)[] = [];
  private cursor = 0;
  constructor(private readonly service: GraphService) {}
  private stop() { this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = undefined; }
  dispose() { this.stop(); }
  reset(objective?: string) { this.stop(); this.steps = []; this.cursor = 0; this.service.reset(objective); }
  pause() {
    if (this.service.snapshot().status !== 'running') return;
    this.stop(); this.service.setRunStatus('paused');
  }
  resume() {
    if (this.service.snapshot().status !== 'paused') return;
    this.service.setRunStatus('running'); this.tick();
  }
  start(objective: string) {
    if (['running', 'paused'].includes(this.service.snapshot().status)) return;
    this.reset(objective); this.service.setRunStatus('running');
    let child: string | null = null;
    this.steps.push(() => { this.service.setAgentStatus('root', 'running'); });
    const stream = (getId: () => string | null, text: string) => {
      Array.from(text).forEach((character, index) => this.steps.push(() => {
        const id = getId(); if (id) this.service.appendMockOutput(id, character, index % 30 === 0);
      }));
    };
    stream(() => 'root', 'MOCK: This fixed demonstration does not call an LLM. Delegating a sample task. ');
    this.steps.push(() => {
      try {
        child = this.service.spawn('root', { name: 'Mock specialist', provider: 'Mock',
          context: { objective: 'Demonstrate delegation.', summary: 'Synthetic test task.', artifacts: [] } });
        this.service.setAgentStatus(child, 'running');
      } catch { this.service.setAgentStatus('root', 'blocked'); this.service.setRunStatus('blocked'); }
    });
    stream(() => child, 'MOCK: Sample task complete. Server graph validation is independent of the client.');
    this.steps.push(() => {
      if (child) this.service.setAgentStatus(child, 'completed');
      this.service.setAgentStatus('root', 'completed');
    });
    this.tick();
  }
  private tick() {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      if (generation !== this.generation || this.service.snapshot().status !== 'running') return;
      this.steps[this.cursor++]?.();
      if (this.service.snapshot().status !== 'running') return;
      if (this.cursor >= this.steps.length) this.service.setRunStatus('completed');
      else this.tick();
    }, 65);
  }
}
