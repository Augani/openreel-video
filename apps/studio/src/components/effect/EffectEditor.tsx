import { useMemo, useState, type CSSProperties } from "react";
import { Icon } from "../../icons";
import { CATS, TYPE_COLOR } from "../../icons";
import { FIRE_GRAPH, GRAPH_PERF, PALETTE, type Graph, type GraphNode, type PaletteGroupData, type Perf } from "../../data";
import { FireScene } from "./FireScene";
import { cn } from "../../lib/cn";

const NODE_HEADER_H = 28;
const NODE_ROW_H = 20;

const INPUT =
  "h-6 w-full rounded border border-border bg-inputbg px-2 text-[11px] text-text-primary outline-none focus:border-accent";
const PANEL_TITLE = "text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary";

function getPortY(node: GraphNode, side: "in" | "out", portId: string): number {
  const list = side === "in" ? node.inputs : node.outputs;
  const idx = list.findIndex((p) => p.id === portId);
  return NODE_HEADER_H + idx * NODE_ROW_H + NODE_ROW_H / 2 + 4;
}

/* ── Sidebar ──────────────────────────────────────────────────── */
function PaletteGroup({ group, query }: { group: PaletteGroupData; query: string }) {
  const cat = CATS[group.cat];
  const [open, setOpen] = useState(true);
  const items = query ? group.items.filter((it) => it.id.toLowerCase().includes(query.toLowerCase())) : group.items;
  if (!items.length) return null;
  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full select-none items-center justify-between px-2.5 py-1.5 hover:bg-hover">
        <span className="flex items-center gap-2 text-[11px] font-medium">
          <span className="h-2 w-2 rounded-sm" style={{ background: cat.color }} />
          {cat.label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-tertiary">{items.length}</span>
          <Icon name="chevronDown" size={12} className={cn("text-text-tertiary transition-transform", !open && "-rotate-90")} />
        </span>
      </button>
      {open && (
        <div className="pb-1.5 pt-0.5">
          {items.map((it) => (
            <div
              key={it.id}
              className={cn(
                "flex cursor-grab select-none items-center gap-2 py-1 pl-[26px] pr-2.5 text-[11px] text-text-secondary hover:bg-hover hover:text-text-primary active:cursor-grabbing",
              )}
            >
              <span className="grid h-3.5 w-3.5 place-items-center text-text-tertiary opacity-70">
                <Icon name={it.icon} size={12} />
              </span>
              <span>{it.id}</span>
              {it.used && <Icon name="check" size={10} className="ml-auto text-accent opacity-80" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetsPanel() {
  const sprites = [
    { name: "fire_a.png", size: "512×512", used: true, bytes: "84 KB" },
    { name: "fire_b.png", size: "512×512", used: false, bytes: "76 KB" },
    { name: "ember.png", size: "256×256", used: false, bytes: "18 KB" },
    { name: "spark_flat.webp", size: "256×256", used: false, bytes: "11 KB" },
  ];
  return (
    <div className="flex flex-col gap-3 overflow-auto p-2.5">
      <div>
        <div className={cn(PANEL_TITLE, "mb-2")}>Sprites · 4</div>
        <div className="flex flex-col gap-1">
          {sprites.map((s) => (
            <div
              key={s.name}
              className={cn(
                "grid grid-cols-[32px_1fr_auto] items-center gap-2 rounded-sm border px-1.5 py-[5px]",
                s.used ? "border-accent bg-accent/15" : "border-transparent",
              )}
            >
              <div
                className="h-8 w-8 rounded-sm border border-border-subtle"
                style={{ background: "radial-gradient(circle at center, #fcd34d, #ea580c 60%, #7c2d12)" }}
              />
              <div>
                <div className="font-mono text-[11px] text-text-primary">{s.name}</div>
                <div className="font-mono text-[9px] text-text-tertiary">{s.size} · {s.bytes}</div>
              </div>
              {s.used && <span className="text-[9px] uppercase tracking-[0.06em] text-accent">in use</span>}
            </div>
          ))}
        </div>
        <button className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-border bg-transparent px-2 py-1 text-[10px] text-text-secondary hover:bg-hover hover:text-text-primary">
          <Icon name="upload" size={11} /> Add sprite
        </button>
      </div>
      <div>
        <div className={cn(PANEL_TITLE, "mb-1.5")}>Bundle size</div>
        <div className="relative h-2 overflow-hidden rounded-sm bg-inputbg">
          <div className="absolute inset-0 w-[37%] bg-accent" />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-text-tertiary">
          <span>189 KB</span>
          <span>cap 50.0 MB</span>
        </div>
      </div>
    </div>
  );
}

function OutlinePanel() {
  return (
    <div className="overflow-auto p-1.5">
      {FIRE_GRAPH.nodes.map((n) => {
        const cat = CATS[n.cat];
        return (
          <div key={n.id} className="flex items-center gap-2 rounded-sm px-2 py-1 text-[11px] text-text-secondary">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
            <span className="flex-1 font-mono text-[10px]">{n.kind}</span>
            <span className="font-mono text-[9px] text-text-tertiary">#{n.id}</span>
          </div>
        );
      })}
    </div>
  );
}

function Sidebar() {
  const [tab, setTab] = useState<"nodes" | "assets" | "layers">("nodes");
  const [q, setQ] = useState("");
  const tabs: { id: typeof tab; label: string }[] = [
    { id: "nodes", label: "Nodes" },
    { id: "assets", label: "Assets" },
    { id: "layers", label: "Outline" },
  ];
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden bg-panel">
      <div className="flex border-b border-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 border-0 border-b border-transparent bg-transparent px-1 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary hover:text-text-primary",
              tab === t.id && "border-b-accent text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "nodes" && (
        <>
          <div className="border-b border-border-subtle px-2 pb-1.5 pt-2">
            <div className="relative">
              <Icon name="search" size={12} className="absolute left-[7px] top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input className={cn(INPUT, "pl-[26px]")} placeholder="Search nodes…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {PALETTE.map((g, i) => (
              <PaletteGroup key={i} group={g} query={q} />
            ))}
          </div>
        </>
      )}
      {tab === "assets" && <AssetsPanel />}
      {tab === "layers" && <OutlinePanel />}
    </aside>
  );
}

/* ── Node ─────────────────────────────────────────────────────── */
function NodeView({ node, selected, onSelect }: { node: GraphNode; selected: boolean; onSelect: (id: string | null) => void }) {
  const cat = CATS[node.cat];
  const rowCount = Math.max(node.inputs.length, node.outputs.length);
  return (
    <div
      className={cn("node", selected && "is-selected")}
      style={{ left: node.x, top: node.y, width: node.w, "--cat": cat.color } as CSSProperties}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
      }}
    >
      <div className="node__header">
        <span className="grid h-3.5 w-3.5 place-items-center" style={{ color: cat.color }}>
          <Icon name={cat.icon} size={12} />
        </span>
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium text-text-primary">{node.kind}</span>
        <span className="font-mono text-[9px] uppercase tracking-[0.04em] text-text-tertiary">#{node.id}</span>
      </div>
      <div className="relative py-1">
        {Array.from({ length: rowCount }).map((_, i) => {
          const ip = node.inputs[i];
          const op = node.outputs[i];
          return (
            <div className="node__row" key={`p${i}`}>
              {ip && (
                <>
                  <span className="node__port is-input" style={{ "--type": TYPE_COLOR[ip.type] } as CSSProperties} />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap text-text-secondary">{ip.name}</span>
                </>
              )}
              {op && (
                <>
                  <span className="ml-auto overflow-hidden text-ellipsis whitespace-nowrap text-right text-text-tertiary">{op.name}</span>
                  <span className="node__port is-output" style={{ "--type": TYPE_COLOR[op.type] } as CSSProperties} />
                </>
              )}
            </div>
          );
        })}
        {node.rows && node.rows.length > 0 && (
          <div className="mt-1 border-t border-dashed border-border-subtle pt-1">
            {node.rows.map((r, i) => (
              <div className="node__row" key={`r${i}`}>
                <span className={cn("overflow-hidden text-ellipsis whitespace-nowrap", r.muted ? "text-text-tertiary" : "text-text-secondary")}>
                  {r.label}
                </span>
                {r.value !== undefined && r.slider === undefined && !r.swatch && <span className="node__value">{r.value}</span>}
                {r.slider !== undefined && (
                  <>
                    <input type="range" className="or-slider or-slider--node" defaultValue={r.slider * 100} min={0} max={100} />
                    <span className="node__value w-[30px] text-right">{r.value}</span>
                  </>
                )}
                {r.swatch && (
                  <span
                    className="ml-auto h-2 w-9 rounded-sm border border-border-subtle"
                    style={{ background: "linear-gradient(90deg, #fde047, #fb923c, #ef4444, transparent)" }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Wires({ graph, selectedNodeId }: { graph: Graph; selectedNodeId: string | null }) {
  const nodesById = useMemo(() => Object.fromEntries(graph.nodes.map((n) => [n.id, n])), [graph]);
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible">
      {graph.edges.map((e, i) => {
        const a = nodesById[e.from[0]];
        const b = nodesById[e.to[0]];
        if (!a || !b) return null;
        const portA = a.outputs.find((p) => p.id === e.from[1]);
        const sy = a.y + getPortY(a, "out", e.from[1]);
        const sx = a.x + a.w;
        const tx = b.x;
        const ty = b.y + getPortY(b, "in", e.to[1]);
        const dx = Math.max(50, Math.abs(tx - sx) * 0.45);
        const d = `M ${sx},${sy} C ${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
        const isSel = selectedNodeId !== null && (e.from[0] === selectedNodeId || e.to[0] === selectedNodeId);
        const color = portA ? TYPE_COLOR[portA.type] : TYPE_COLOR.any;
        return (
          <path key={i} d={d} fill="none" stroke={color} strokeOpacity={isSel ? 1 : 0.7} strokeWidth={isSel ? 2 : 1.5} />
        );
      })}
    </svg>
  );
}

function GraphCanvas({ graph, selectedNodeId, onSelect, perf }: { graph: Graph; selectedNodeId: string | null; onSelect: (id: string | null) => void; perf: Perf }) {
  const [tool, setTool] = useState<"select" | "pan">("select");
  const [zoom, setZoom] = useState(0.58);
  const [pan, setPan] = useState({ x: 4, y: 24 });
  const frameTotal = perf.gpu + perf.detection;

  return (
    <section className="relative flex min-h-0 flex-col overflow-hidden bg-panel">
      <div className="absolute left-2.5 top-2.5 z-[5] flex items-center gap-1 rounded-md border border-border bg-elev1 p-[3px] shadow-float">
        <div className="flex items-center gap-0.5">
          <button onClick={() => setTool("select")} title="Select" className={cn("grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary", tool === "select" && "bg-accent/15 text-accent")}>
            <Icon name="mouse" size={13} />
          </button>
          <button onClick={() => setTool("pan")} title="Pan" className={cn("grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary", tool === "pan" && "bg-accent/15 text-accent")}>
            <Icon name="hand" size={13} />
          </button>
        </div>
        <div className="mx-1 h-3.5 w-px bg-border" />
        <div className="flex items-center gap-0.5">
          <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} title="Zoom out" className="grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary">
            <Icon name="zoomOut" size={13} />
          </button>
          <span className="w-9 text-center font-mono text-[10px] text-text-tertiary">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} title="Zoom in" className="grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary">
            <Icon name="zoomIn" size={13} />
          </button>
          <button onClick={() => { setZoom(0.58); setPan({ x: 4, y: 24 }); }} title="Fit" className="grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary">
            <Icon name="fit" size={13} />
          </button>
        </div>
        <div className="mx-1 h-3.5 w-px bg-border" />
        <div className="flex items-center gap-0.5">
          <button title="Snap to grid" className="grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary"><Icon name="grid" size={13} /></button>
          <button title="Auto-layout" className="grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary"><Icon name="git" size={13} /></button>
          <button title="Validate" className="grid h-[22px] w-[22px] place-items-center rounded-sm text-text-secondary hover:bg-hover hover:text-text-primary"><Icon name="check" size={13} /></button>
        </div>
      </div>

      <div className="absolute bottom-2.5 left-2.5 z-[5] w-[200px] rounded-md border border-border bg-elev1 px-2.5 py-2 font-mono text-[10px] shadow-float">
        <div className="mb-1.5 flex items-center justify-between text-[9px] uppercase tracking-[0.08em] text-text-tertiary">
          <span>Performance · sample · portrait_close_up</span>
          <span className="text-ok">● live</span>
        </div>
        <div className="flex items-center justify-between py-px text-text-secondary">
          <span>frame total</span>
          <span className="text-text-primary">{frameTotal.toFixed(1)} / 16 ms</span>
        </div>
        <div className="mt-0.5 h-1 overflow-hidden rounded-sm bg-inputbg">
          <div className="h-full bg-accent" style={{ width: `${Math.min(100, (frameTotal / 16) * 100)}%` }} />
        </div>
        <div className="h-1.5" />
        <div className="flex items-center justify-between py-px text-text-secondary"><span>· gpu passes</span><span className="text-text-primary">{perf.gpu}ms · {perf.passes}p</span></div>
        <div className="flex items-center justify-between py-px text-text-secondary"><span>· detection</span><span className="text-text-primary">{perf.detection}ms</span></div>
        <div className="flex items-center justify-between py-px text-text-secondary"><span>· particles</span><span className="text-text-primary">{perf.particles}</span></div>
        <div className="flex items-center justify-between py-px text-text-secondary"><span>· texture mem</span><span className="text-text-primary">{perf.mem} MB</span></div>
        <div className="flex items-center justify-between py-px text-text-secondary"><span>· determinism</span><span className="text-ok">PASS</span></div>
      </div>

      <div className="canvas-viewport relative flex-1 overflow-hidden" onClick={() => onSelect(null)}>
        <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <Wires graph={graph} selectedNodeId={selectedNodeId} />
          {graph.nodes.map((n) => (
            <NodeView key={n.id} node={n} selected={selectedNodeId === n.id} onSelect={onSelect} />
          ))}
        </div>
      </div>

      <div className="absolute bottom-2.5 right-2.5 h-[110px] w-[180px] overflow-hidden rounded-md border border-border bg-elev1 shadow-float">
        <div className="absolute inset-0 bg-elev2" />
        {graph.nodes.map((n) => {
          const cat = CATS[n.cat];
          return (
            <div
              key={n.id}
              className="absolute h-[5px] rounded-[1px]"
              style={{
                left: (n.x / 1600) * 160,
                top: (n.y / 360) * 60 + 18,
                width: (n.w / 1600) * 160,
                background: cat.color,
                opacity: selectedNodeId === n.id ? 1 : 0.6,
              }}
            />
          );
        })}
        <div className="pointer-events-none absolute rounded-[2px] border border-accent" style={{ inset: "12px 28px 24px 8px" }} />
      </div>
    </section>
  );
}

/* ── Inspector ────────────────────────────────────────────────── */
function Inspector({ graph, selectedId }: { graph: Graph; selectedId: string | null }) {
  const node = graph.nodes.find((n) => n.id === selectedId) ?? graph.nodes.find((n) => n.id === "emit")!;
  const cat = CATS[node.cat];
  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden bg-panel">
      <div className="border-b border-border-subtle px-3 pb-2 pt-2.5">
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-3.5 w-3.5 place-items-center rounded-sm text-white" style={{ background: cat.color }}>
            <Icon name={cat.icon} size={9} strokeWidth={2} />
          </span>
          <span className="text-[13px] font-semibold text-text-primary">{node.kind}</span>
        </div>
        <div className="font-mono text-[10px] text-text-tertiary">#{node.id} · {cat.label} · ABI 1.2</div>
      </div>

      <div className="flex-1 overflow-auto">
        {node.kind === "ParticleEmitter" ? (
          <>
            <InspectorGroup title="Emission">
              <Field label="rate">
                <input type="range" className="or-slider" defaultValue={20} />
                <span className="binding ml-0 min-w-[64px]"><BindingText>200 <span className="text-text-tertiary">/s</span></BindingText></span>
              </Field>
              <Field label="lifetime">
                <input className={cn(INPUT, "max-w-[60px]")} defaultValue="1.2" />
                <span className="font-mono text-[10px] text-text-tertiary">±</span>
                <input className={cn(INPUT, "max-w-[60px]")} defaultValue="0.3" />
                <span className="font-mono text-[10px] text-text-tertiary">s</span>
              </Field>
              <Field label="max">
                <input className={INPUT} defaultValue="2048" />
                <span className="font-mono text-[10px] text-text-tertiary">/ 2048 cap</span>
              </Field>
            </InspectorGroup>

            <InspectorGroup title="Initial state">
              <Field label="velocity">
                <input className={INPUT} defaultValue="0" />
                <input className={INPUT} defaultValue="−200" />
              </Field>
              <Field label="jitter">
                <input type="range" className="or-slider" defaultValue={35} />
                <span className="font-mono text-[10px] text-text-primary">0.35</span>
              </Field>
              <Field label="size">
                <input className={INPUT} defaultValue="6" />
                <span className="font-mono text-[10px] text-text-tertiary">→</span>
                <input className={INPUT} defaultValue="14" />
                <span className="font-mono text-[10px] text-text-tertiary">px</span>
              </Field>
            </InspectorGroup>

            <InspectorGroup title="Bindings · 2 incoming">
              <div className="flex flex-col gap-1">
                <div className="binding"><span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--type-vec)" }} /><BindingText>spawn ← MaskEdgeEmitter.pts</BindingText></div>
                <div className="binding"><span className="h-[7px] w-[7px] rounded-full" style={{ background: "var(--type-float)" }} /><BindingText>rate ← (default · 200)</BindingText></div>
              </div>
            </InspectorGroup>

            <InspectorGroup title="Compiles to">
              <div className="rounded border border-border-subtle bg-inputbg p-2 font-mono text-[10px] leading-[1.6] text-text-secondary">
                <div><span className="text-[color:var(--cat-particles)]">@compute</span> @workgroup_size(64)</div>
                <div>fn <span className="text-accent-2">update_emitter</span>() {"{"}</div>
                <div className="pl-3">// generated from graph #emit</div>
                <div className="pl-3">// resp. lib particles@1.2.0</div>
                <div>{"}"}</div>
              </div>
            </InspectorGroup>
          </>
        ) : (
          <>
            <InspectorGroup title="Properties">
              {(node.rows ?? []).map((r, i) => (
                <Field label={r.label} key={i}>
                  {r.slider !== undefined ? (
                    <>
                      <input type="range" className="or-slider" defaultValue={r.slider * 100} />
                      <span className="font-mono text-[10px]">{r.value}</span>
                    </>
                  ) : (
                    <input className={INPUT} defaultValue={r.value ?? "—"} />
                  )}
                </Field>
              ))}
              {(!node.rows || node.rows.length === 0) && <div className="text-[11px] text-text-tertiary">No configurable properties.</div>}
            </InspectorGroup>
            <InspectorGroup title="Ports">
              <div className="flex flex-col gap-1">
                {node.inputs.map((p) => (
                  <div className="binding" key={`i${p.id}`}>
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: TYPE_COLOR[p.type] }} />
                    <BindingText>in · {p.name}</BindingText>
                    <span className="font-mono text-[9px] text-text-tertiary">{p.type}</span>
                  </div>
                ))}
                {node.outputs.map((p) => (
                  <div className="binding" key={`o${p.id}`}>
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: TYPE_COLOR[p.type] }} />
                    <BindingText>out · {p.name}</BindingText>
                    <span className="font-mono text-[9px] text-text-tertiary">{p.type}</span>
                  </div>
                ))}
              </div>
            </InspectorGroup>
          </>
        )}
      </div>
    </aside>
  );
}

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border-subtle px-3 pb-2.5 pt-2 last:border-b-0">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-[3px]">
      <label className="text-[11px] text-text-secondary">{label}</label>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function BindingText({ children }: { children: React.ReactNode }) {
  return <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">{children}</span>;
}

/* ── Preview pane ─────────────────────────────────────────────── */
function PreviewPane() {
  const [playing, setPlaying] = useState(true);
  const [quality, setQuality] = useState<"full" | "balanced" | "perf">("balanced");
  const [showMask, setShowMask] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [sideBySide, setSideBySide] = useState(false);
  const [intensity, setIntensity] = useState(70);

  return (
    <section className="flex min-h-0 flex-col bg-panel">
      <header className="flex h-[30px] items-center justify-between border-b border-border-subtle bg-panel px-2.5">
        <span className={PANEL_TITLE}>Preview · sample portrait_close_up.mp4</span>
        <div className="flex gap-1">
          <button className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] text-text-secondary hover:bg-hover hover:text-text-primary"><Icon name="refresh" size={11} /> Reload sample</button>
          <button className="flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] text-text-secondary hover:bg-hover hover:text-text-primary"><Icon name="monitor" size={11} /> portrait_close_up ▾</button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_220px]">
        <div className="relative flex min-h-0 items-stretch overflow-hidden bg-[#050507]">
          <div className="relative block h-full overflow-hidden bg-[#050307]" style={{ width: sideBySide ? "60%" : "100%" }}>
            <FireScene intensity={intensity / 100 + 0.4} />
            {showMask && (
              <svg className="pointer-events-none absolute inset-0 z-[5]" viewBox="0 0 220 320" preserveAspectRatio="xMidYMid meet">
                <path
                  d="M 66,150  Q 50,180 53,250  L 56,320 M 164,320  L 167,250  Q 170,180 154,150 M 83,72 Q 83,30 110,30 Q 137,30 137,72 Q 137,112 110,112 Q 83,112 83,72 Z"
                  fill="none"
                  stroke="rgb(var(--accent-2))"
                  strokeWidth="0.8"
                  strokeDasharray="2 1.2"
                  opacity="0.9"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            {showSkeleton && (
              <svg className="pointer-events-none absolute inset-0 z-[5]" viewBox="0 0 220 320" preserveAspectRatio="xMidYMid meet">
                <g stroke="rgb(var(--accent))" strokeWidth="1.2" fill="rgb(var(--accent))" opacity="0.95" vectorEffect="non-scaling-stroke">
                  <circle cx="110" cy="72" r="2" />
                  <circle cx="82" cy="148" r="2" />
                  <circle cx="138" cy="148" r="2" />
                  <circle cx="96" cy="230" r="2" />
                  <circle cx="124" cy="230" r="2" />
                  <line x1="110" y1="82" x2="110" y2="148" />
                  <line x1="82" y1="148" x2="138" y2="148" />
                  <line x1="110" y1="148" x2="96" y2="230" />
                  <line x1="110" y1="148" x2="124" y2="230" />
                </g>
              </svg>
            )}
          </div>
          {sideBySide && (
            <div className="relative h-full w-[40%] border-l border-dashed border-border" style={{ background: "linear-gradient(180deg, #0a0a0e 0%, #050507 100%)" }}>
              <svg viewBox="0 0 220 320" preserveAspectRatio="xMidYMid meet" className="h-full w-full">
                <ellipse cx="110" cy="72" rx="27" ry="40" fill="#3a3050" />
                <ellipse cx="98" cy="42" rx="13" ry="11" fill="#2a2240" />
                <ellipse cx="121" cy="38" rx="13" ry="11" fill="#2a2240" />
                <rect x="99" y="115" width="22" height="36" fill="#3a3050" />
                <path d="M 66,150 Q 50,180 53,250 L 56,320 L 164,320 L 167,250 Q 170,180 154,150 Z" fill="#3a3050" />
              </svg>
              <div className="absolute bottom-2 right-2 font-mono text-[9px] tracking-[0.08em] text-white/50">SOURCE</div>
            </div>
          )}
          <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-sm bg-black/50 px-2 py-1 font-mono text-[10px] text-white/80 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
            <span>9.1 ms · {playing ? "▶ 00:02.13" : "❚❚ 00:02.13"}</span>
            <span className="text-white/40">·</span>
            <span>1080p · 30 fps</span>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-l border-border-subtle bg-panel p-2.5 text-[11px]">
          <div>
            <div className={cn(PANEL_TITLE, "text-[9px]")}>Parameters</div>
            <div className="flex flex-col gap-1 py-[3px]">
              <div className="flex justify-between">
                <label className="text-[11px] text-text-secondary">intensity</label>
                <span className="font-mono text-[10px]">{(intensity / 100).toFixed(2)}</span>
              </div>
              <input type="range" className="or-slider" value={intensity} onChange={(e) => setIntensity(+e.target.value)} />
            </div>
            <div className="flex flex-col gap-1 py-[3px]">
              <div className="flex justify-between">
                <label className="text-[11px] text-text-secondary">flame color</label>
                <span className="font-mono text-[10px]">#FF7700</span>
              </div>
              <div className="flex gap-1">
                <span className="h-[18px] w-[18px] flex-shrink-0 cursor-pointer rounded-sm border border-border" style={{ background: "#ff7700" }} />
                <input className={cn(INPUT, "flex-1 font-mono")} defaultValue="#FF7700" />
              </div>
            </div>
          </div>

          <div>
            <div className={cn(PANEL_TITLE, "text-[9px]")}>Detection overlay</div>
            <div className="flex flex-col gap-[5px] pt-1.5">
              <Toggle checked={showMask} onChange={setShowMask} swatch="rgb(var(--accent-2))" label="Subject mask outline" />
              <Toggle checked={showSkeleton} onChange={setShowSkeleton} swatch="rgb(var(--accent))" label="Pose skeleton" />
              <Toggle swatch="var(--cat-temporal)" label="Face landmarks" />
              <Toggle swatch="var(--cat-detection)" label="Depth heatmap" />
            </div>
          </div>

          <div>
            <div className={cn(PANEL_TITLE, "text-[9px]")}>Inspect</div>
            <div className="flex flex-col gap-[5px] pt-1.5">
              <Toggle checked={sideBySide} onChange={setSideBySide} label="Show source side-by-side" />
              <Toggle label="Loop sample (3s)" />
              <Toggle defaultChecked label="Sync slider to clock" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-9 items-center gap-2.5 border-t border-border-subtle bg-panel px-2.5">
        <button onClick={() => setPlaying((p) => !p)} className="grid h-[22px] w-6 place-items-center rounded text-text-secondary hover:bg-hover hover:text-text-primary">
          <Icon name={playing ? "pause" : "play"} size={12} />
        </button>
        <span className="font-mono text-[10px] text-text-tertiary">00:02.13 / 00:05.00</span>
        <div className="relative h-1 flex-1 cursor-pointer rounded-sm bg-inputbg">
          <div className="absolute bottom-0 left-0 top-0 rounded-sm bg-accent" style={{ width: "42%" }} />
          <div className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary" style={{ left: "42%" }} />
        </div>
        <div className="flex items-center overflow-hidden rounded border border-border">
          {(["full", "balanced", "perf"] as const).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={cn("border-0 bg-transparent px-2 py-[3px] text-[10px] uppercase tracking-[0.06em] text-text-tertiary", quality === q && "bg-accent/15 text-accent")}
            >
              {q}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Toggle({ checked, defaultChecked, onChange, swatch, label }: { checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; swatch?: string; label: string }) {
  return (
    <label className="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-text-secondary">
      <input
        type="checkbox"
        className="accent-accent"
        checked={onChange ? checked : undefined}
        defaultChecked={onChange ? undefined : defaultChecked}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
      />
      {swatch && <span className="h-2 w-2 rounded-sm" style={{ background: swatch }} />}
      <span>{label}</span>
    </label>
  );
}

/* ── Compose ──────────────────────────────────────────────────── */
export function EffectEditor() {
  const [selectedId, setSelectedId] = useState<string | null>("emit");
  const perf = GRAPH_PERF;
  return (
    <div className="grid h-full min-h-0 grid-cols-[240px_1fr_280px] gap-px bg-base [&>*]:min-h-0 [&>*]:min-w-0 [&>*]:bg-panel">
      <Sidebar />
      <div className="grid min-h-0 grid-rows-[1fr_340px] gap-px">
        <GraphCanvas graph={FIRE_GRAPH} selectedNodeId={selectedId} onSelect={setSelectedId} perf={perf} />
        <PreviewPane />
      </div>
      <Inspector graph={FIRE_GRAPH} selectedId={selectedId} />
    </div>
  );
}
