import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "../../icons";
import { TRAVEL_TEMPLATE, type SlotKind } from "../../data";
import { Button } from "../Button";
import { cn } from "../../lib/cn";

const SLOT_ICON: Record<SlotKind, IconName> = {
  video: "video",
  text: "text",
  audio: "music",
  image: "image",
};

const TRACK_CLIP_COLOR: Record<string, { cat: string; catDark: string; catBorder: string }> = {
  v1: { cat: "rgba(34,197,94,0.45)", catDark: "rgba(34,197,94,0.2)", catBorder: "rgba(34,197,94,0.6)" },
  t1: { cat: "rgba(45,212,191,0.45)", catDark: "rgba(45,212,191,0.2)", catBorder: "rgba(45,212,191,0.6)" },
  a1: { cat: "rgba(251,191,36,0.45)", catDark: "rgba(251,191,36,0.2)", catBorder: "rgba(251,191,36,0.6)" },
};

function MetaPill({ label, value, ok, mono }: { label: string; value: ReactNode; ok?: boolean; mono?: boolean }) {
  return (
    <div className="flex min-w-[64px] flex-col gap-px whitespace-nowrap rounded-sm border border-border-subtle bg-panel px-2.5 py-1">
      <span className="whitespace-nowrap text-[9px] uppercase tracking-[0.08em] text-text-tertiary">{label}</span>
      <span className={cn("whitespace-nowrap text-xs font-medium", mono && "font-mono", ok ? "text-ok" : "text-text-primary")}>{value}</span>
    </div>
  );
}

function TimelineRuler({ duration }: { duration: number }) {
  const seconds = duration / 1000;
  const ticks = Array.from({ length: Math.ceil(seconds) + 1 });
  return (
    <div className="relative flex h-[18px] select-none border-b border-border-subtle font-mono text-[9px] text-text-tertiary">
      {ticks.map((_, i) => (
        <div key={i} className="flex-1 border-l border-border-subtle px-1 py-0.5">{i}s</div>
      ))}
    </div>
  );
}

export function TemplateAuthor() {
  const tpl = TRAVEL_TEMPLATE;
  const [selectedSlot, setSelectedSlot] = useState("clip1");
  const selected = tpl.slots.find((s) => s.id === selectedSlot);

  return (
    <main className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <header className="flex items-center justify-between border-b border-border-subtle bg-panel px-5 py-3.5">
        <div>
          <div className="text-sm font-semibold">{tpl.meta.title}</div>
          <div className="whitespace-nowrap font-mono text-[11px] text-text-tertiary">
            template · {tpl.meta.aspect} · {(tpl.meta.duration_ms / 1000).toFixed(1)}s · {tpl.meta.fps}fps · 5 slots
          </div>
        </div>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm"><Icon name="eye" size={11} /> Test fill</Button>
          <Button variant="ghost" size="sm"><Icon name="file" size={11} /> Inspect EDL</Button>
          <Button size="sm"><Icon name="plus" size={11} /> Add slot</Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[1fr_280px]">
        <section className="flex flex-col gap-2 overflow-auto bg-base px-5 py-4">
          <div className="flex gap-3 border-b border-border-subtle pb-3">
            <MetaPill label="Aspect" value={tpl.meta.aspect} />
            <MetaPill label="Duration" value={`${tpl.meta.duration_ms / 1000}s`} />
            <MetaPill label="FPS" value={tpl.meta.fps} />
            <MetaPill label="Slots" value={tpl.slots.length} />
            <MetaPill label="FX refs" value="2" ok />
            <MetaPill label="Compiles to" value="EDL JSON" mono />
          </div>

          <TimelineRuler duration={tpl.meta.duration_ms} />

          {tpl.tracks.map((track) => {
            const cs = TRACK_CLIP_COLOR[track.id];
            return (
              <div key={track.id} className="grid min-h-[56px] grid-cols-[100px_1fr] items-center gap-2">
                <div className="flex items-center gap-1.5 p-1 text-[11px] text-text-secondary">
                  <span className="text-text-tertiary"><Icon name={SLOT_ICON[track.kind]} size={12} /></span>
                  <div>
                    <div className="font-mono text-[10px]">{track.id}</div>
                    <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">{track.kind}</div>
                  </div>
                </div>
                <div className="relative flex h-12 gap-1 overflow-hidden rounded border border-border-subtle bg-panel p-1">
                  {track.items.map((it, i) => {
                    const w = ((it.out - it.in) / tpl.meta.duration_ms) * 100;
                    const left = (it.in / tpl.meta.duration_ms) * 100;
                    const isSel = selectedSlot === it.slot;
                    return (
                      <div
                        key={i}
                        onClick={() => setSelectedSlot(it.slot)}
                        className={cn("timeline-clip", it.fx && "is-fx-tagged")}
                        style={{
                          position: "absolute",
                          left: `calc(${left}% + 4px)`,
                          width: `calc(${w}% - 8px)`,
                          top: 4,
                          bottom: 4,
                          "--cat": cs.cat,
                          "--cat-dark": cs.catDark,
                          "--cat-border": cs.catBorder,
                          boxShadow: isSel ? "0 0 0 1.5px rgb(var(--accent))" : "none",
                        } as CSSProperties}
                      >
                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{it.slot}</span>
                        <span className="text-[9px] text-white/70">{((it.out - it.in) / 1000).toFixed(1)}s</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="grid min-h-[56px] grid-cols-[100px_1fr] items-center gap-2">
            <div className="flex items-center gap-1.5 p-1 text-[11px] text-text-secondary">
              <span className="text-text-tertiary"><Icon name="sparkle" size={12} /></span>
              <div>
                <div className="font-mono text-[10px]">fx refs</div>
                <div className="text-[9px] uppercase tracking-[0.06em] text-text-tertiary">baked</div>
              </div>
            </div>
            <div className="relative flex h-12 gap-1 overflow-hidden rounded border border-dashed border-border-subtle p-1">
              <div
                className="absolute top-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-2 font-mono text-[10px] text-text-primary"
                style={{ left: "calc(0% + 4px)", width: "calc(20% - 8px)", bottom: 4, background: "linear-gradient(180deg, rgba(251,146,60,0.4), rgba(124,45,18,0.3))", border: "1px solid rgba(251,146,60,0.6)" }}
              >
                <Icon name="flame" size={10} /> warm-vignette@1.0
              </div>
              <div
                className="absolute top-1 flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-2 font-mono text-[10px] text-text-primary"
                style={{ left: "calc(40% + 4px)", width: "calc(60% - 8px)", bottom: 4, background: "linear-gradient(180deg, rgba(248,113,113,0.4), rgba(127,29,29,0.3))", border: "1px solid rgba(248,113,113,0.6)" }}
              >
                <Icon name="flame" size={10} /> fire-aura@1.2
                <span className="ml-auto text-text-tertiary">{"{ intensity: 0.7 }"}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-[100px_1fr_auto] items-center gap-4 rounded-md border border-border-subtle bg-panel p-3">
            <div className="relative aspect-[9/16] rounded-sm" style={{ background: "linear-gradient(135deg, #fb923c, #ea580c, #7c2d12)" }}>
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(circle 1.5px at 30% 60%, #fcd34d, transparent), radial-gradient(circle 1.5px at 50% 50%, #fef3c7, transparent), radial-gradient(circle 1.5px at 70% 65%, #f59e0b, transparent)",
                  mixBlendMode: "screen",
                }}
              />
              <div className="absolute bottom-1 left-1 font-mono text-[8px] text-white">LAGOS · 2026</div>
            </div>
            <div>
              <div className="mb-0.5 text-xs font-semibold">Compiled preview · 9:16 · 15.0s</div>
              <div className="font-mono text-[10px] text-text-tertiary">Filled with sample media. fx refs resolved against creator/augani.</div>
            </div>
            <Button size="sm"><Icon name="play" size={11} /> Play test fill</Button>
          </div>
        </section>

        <aside className="flex flex-col gap-3.5 overflow-y-auto border-l border-border-subtle bg-panel p-4">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Slots · {tpl.slots.length}</div>
            <div className="flex flex-col gap-1.5">
              {tpl.slots.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSlot(s.id)}
                  className="flex cursor-pointer flex-col gap-1.5 rounded-md border bg-elev1 px-3 py-2.5"
                  style={{ borderColor: selectedSlot === s.id ? "rgb(var(--accent))" : "rgb(var(--b-default))" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-sm border border-border bg-inputbg px-[5px] py-px font-mono text-[9px] uppercase tracking-[0.06em] text-text-secondary">{s.kind}</span>
                    <span className="flex-1 text-xs font-semibold text-text-primary">{s.id}</span>
                    <Icon name={SLOT_ICON[s.kind]} size={11} />
                  </div>
                  <div className="text-[11px] text-text-secondary">{s.label}</div>
                  <div className="flex gap-3 whitespace-nowrap font-mono text-[10px] text-text-tertiary">
                    {s.kind === "video" && (
                      <>
                        <span><b className="font-normal text-text-secondary">min</b> {((s.min ?? 0) / 1000).toFixed(1)}s</span>
                        <span><b className="font-normal text-text-secondary">max</b> {((s.max ?? 0) / 1000).toFixed(1)}s</span>
                      </>
                    )}
                    {s.kind === "text" && <span><b className="font-normal text-text-secondary">max</b> {s.max_chars} chars</span>}
                    {s.kind === "audio" && <span><b className="font-normal text-text-secondary">type</b> opus / ogg</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">Selected · {selectedSlot}</div>
            <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-[3px]">
              <label className="text-[11px] text-text-secondary">label</label>
              <input className="h-6 w-full rounded border border-border bg-inputbg px-2 text-[11px] text-text-primary outline-none focus:border-accent" defaultValue={selected?.label} key={selectedSlot} />
            </div>
            <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-[3px]">
              <label className="text-[11px] text-text-secondary">required</label>
              <div className="flex items-center gap-1.5">
                <input type="checkbox" className="accent-accent" defaultChecked />
                <span className="text-[11px] text-text-secondary">User must provide</span>
              </div>
            </div>
            <div className="grid grid-cols-[80px_1fr] items-center gap-2 py-[3px]">
              <label className="text-[11px] text-text-secondary">default</label>
              <input className="h-6 w-full rounded border border-border bg-inputbg px-2 text-[11px] text-text-primary outline-none focus:border-accent" defaultValue="—" />
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">EDL excerpt</div>
            <pre className="m-0 overflow-auto rounded border border-border-subtle bg-inputbg p-2 font-mono text-[9.5px] leading-[1.6] text-text-secondary">{`{
  "slot": "${selectedSlot}",
  "kind": "video",
  "min_duration_ms": 1500,
  "max_duration_ms": 3000,
  "fx": [{
    "fx_id":
     "augani/warm-vignette@1.0.0",
    "params":
     { "amount": 0.6 }
  }]
}`}</pre>
          </div>
        </aside>
      </div>
    </main>
  );
}
