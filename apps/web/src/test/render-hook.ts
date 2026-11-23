// Minimal React DevTools hook so tests can count component renders per commit
// (a fiber whose PerformedWork flag is set rendered in that commit). It must be
// installed before react-dom loads, so it is the first vitest setup file.
// Counting is off unless a test calls startRenderCounting().

type Fiber = {
  tag: number;
  type: unknown;
  flags: number;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
};

const PERFORMED_WORK = 1;
const FUNCTION_COMPONENT = 0;
const CLASS_COMPONENT = 1;
const FORWARD_REF = 11;
const MEMO_COMPONENT = 14;
const SIMPLE_MEMO_COMPONENT = 15;

interface Counter {
  commits: number;
  renders: Map<string, number>;
}

let active: Counter | null = null;

interface NamedType {
  displayName?: string;
  name?: string;
  render?: { displayName?: string; name?: string };
  type?: { name?: string };
}

function nameOf(fiber: Fiber): string | null {
  const type = fiber.type as NamedType | ((...args: unknown[]) => unknown) | null;
  if (!type) return null;
  const named = type as NamedType;
  return named.displayName || named.name || named.render?.displayName || named.render?.name || named.type?.name || "Anonymous";
}

function walk(fiber: Fiber | null, counter: Counter): void {
  while (fiber) {
    const { tag } = fiber;
    const component = tag === FUNCTION_COMPONENT || tag === CLASS_COMPONENT || tag === FORWARD_REF
      || tag === MEMO_COMPONENT || tag === SIMPLE_MEMO_COMPONENT;
    // Bailed-out fibers keep their old flags from the previous render, so only a
    // fiber that differs from its alternate (or is new) really rendered.
    if (component && (fiber.flags & PERFORMED_WORK) !== 0 && (tag !== MEMO_COMPONENT)) {
      const name = nameOf(fiber);
      if (name) counter.renders.set(name, (counter.renders.get(name) ?? 0) + 1);
    }
    // Same child object as the alternate means the whole subtree bailed out.
    const prev = fiber.alternate;
    if (!prev || prev.child !== fiber.child) walk(fiber.child, counter);
    fiber = fiber.sibling;
  }
}

const hook = {
  supportsFiber: true,
  renderers: new Map(),
  inject() { return 1; },
  checkDCE() {},
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  onCommitFiberRoot(_id: number, root: { current: Fiber }) {
    if (!active) return;
    active.commits += 1;
    walk(root.current, active);
  },
};

const g = globalThis as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
if (!g.__REACT_DEVTOOLS_GLOBAL_HOOK__) g.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

export interface RenderSnapshot {
  commits: number;
  total: number;
  byComponent: Record<string, number>;
}

export function startRenderCounting(): void {
  active = { commits: 0, renders: new Map() };
}

export function stopRenderCounting(): RenderSnapshot {
  const counter = active ?? { commits: 0, renders: new Map() };
  active = null;
  const byComponent: Record<string, number> = {};
  let total = 0;
  for (const [name, count] of counter.renders) {
    byComponent[name] = count;
    total += count;
  }
  return { commits: counter.commits, total, byComponent };
}
