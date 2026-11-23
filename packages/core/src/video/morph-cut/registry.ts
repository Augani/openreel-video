import { IDLE_MORPH_CUT_STATE, type MorphAnalysis, type MorphCutState } from "./types";

/**
 * Runtime state of Morph Cut analyses. Deliberately tiny and dependency free: the transition engine and the UI read
 * it on the main bundle, while the analysis and render code (features, optical flow, WebGPU) load on demand.
 *
 * `states` is what the transition shows; `results` caches finished analyses by their content key (footage identity,
 * reference times, size, settings) so undo/redo, re-applying or a duplicate transition reuses them. `active` maps a
 * transition id to the key it currently renders with.
 */
type Listener = () => void;

const RESULT_LIMIT = 24;

export class MorphCutRegistry {
  private readonly states = new Map<string, MorphCutState>();
  private readonly active = new Map<string, string>();
  private readonly results = new Map<string, MorphAnalysis>();
  private readonly listeners = new Set<Listener>();
  private version = 0;

  getState(transitionId: string): MorphCutState {
    return this.states.get(transitionId) ?? IDLE_MORPH_CUT_STATE;
  }

  /** Changes on every state change (a cheap useSyncExternalStore snapshot). */
  getVersion(): number {
    return this.version;
  }

  setState(transitionId: string, state: MorphCutState): void {
    this.states.set(transitionId, state);
    this.emit();
  }

  clearState(transitionId: string): void {
    const had = this.states.delete(transitionId);
    this.active.delete(transitionId);
    if (had) this.emit();
  }

  hasResult(key: string): boolean {
    return this.results.has(key);
  }

  getResult(key: string): MorphAnalysis | undefined {
    const hit = this.results.get(key);
    if (hit) {
      this.results.delete(key);
      this.results.set(key, hit);
    }
    return hit;
  }

  putResult(key: string, analysis: MorphAnalysis): void {
    this.results.delete(key);
    this.results.set(key, analysis);
    while (this.results.size > RESULT_LIMIT) {
      const oldest = this.results.keys().next().value as string;
      this.results.delete(oldest);
    }
  }

  /** The transition renders with the analysis cached under `key`. */
  activate(transitionId: string, key: string): void {
    this.active.set(transitionId, key);
  }

  /** The transition stops rendering with an analysis (it dissolves until a new one is activated). */
  deactivate(transitionId: string): void {
    this.active.delete(transitionId);
  }

  /** The finished, usable analysis the transition renders with right now, or null (it renders as a cross dissolve). */
  resolve(transitionId: string): MorphAnalysis | null {
    const key = this.active.get(transitionId);
    if (!key) return null;
    const analysis = this.results.get(key);
    return analysis && analysis.ok && analysis.field ? analysis : null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.states.clear();
    this.active.clear();
    this.results.clear();
    this.emit();
  }

  private emit(): void {
    this.version++;
    for (const listener of [...this.listeners]) listener();
  }
}

let shared: MorphCutRegistry | null = null;
export function getMorphCutRegistry(): MorphCutRegistry {
  if (!shared) shared = new MorphCutRegistry();
  return shared;
}
