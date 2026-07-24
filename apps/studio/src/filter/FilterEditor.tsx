import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { nanoid } from "nanoid";
import { AdjustmentStack } from "./AdjustmentStack";
import { addAdjustment, emptyFilterDoc, moveAdjustment, removeAdjustment, setAdjustmentParam } from "./store";
import type { FilterDoc } from "./types";
import { BehaviorPaletteSheet } from "../effect/BehaviorPaletteSheet";
import { ParamField, fieldsFromObjectSchema } from "../effect/param-renderers";
import { getBehavior } from "../effect/behaviors/registry";
import { PreviewEngine } from "../effect/preview/PreviewEngine";
import { VideoSource } from "../effect/preview/VideoSource";
import { loadSampleClips } from "../effect/sample-clips";
import type { Behavior } from "../effect/scene";

export function FilterEditor({ initialDoc }: { initialDoc?: FilterDoc } = {}) {
  const [doc, setDoc] = useState<FilterDoc>(initialDoc ?? emptyFilterDoc());
  const [selected, setSelected] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);

  const selectedAdjustment = doc.adjustments.find((a) => a.id === selected);
  const selectedDef = selectedAdjustment
    ? getBehavior(selectedAdjustment.kind === "preset" ? selectedAdjustment.presetId : `atomic.${selectedAdjustment.atomicKind}`)
    : null;

  function handleAdd(behaviorId: string) {
    const def = getBehavior(behaviorId);
    if (!def) return;
    const id = nanoid(8);
    const adjustment: Behavior = def.kind === "preset"
      ? { id, kind: "preset", presetId: def.id, params: { ...(def.defaultParams as Record<string, unknown>) }, name: def.label, visible: true }
      : { id, kind: "atomic", atomicKind: def.atomicKind!, params: { ...(def.defaultParams as Record<string, unknown>) }, name: def.label, visible: true };
    setDoc((d) => addAdjustment(d, adjustment));
    setSelected(id);
    setPalette(false);
  }

  return (
    <div className="relative grid h-full grid-cols-[1fr_380px]">
      <section className="flex flex-col bg-zinc-950">
        <FilterPreview doc={doc} />
      </section>
      <aside className="flex flex-col border-l border-zinc-800 bg-zinc-950">
        <AdjustmentStack
          adjustments={doc.adjustments}
          selectedId={selected}
          onSelect={setSelected}
          onAdd={() => setPalette(true)}
          onRemove={(id) => {
            setDoc((d) => removeAdjustment(d, id));
            if (selected === id) setSelected(null);
          }}
          onMove={(from, to) => setDoc((d) => moveAdjustment(d, from, to))}
        />
        {selectedAdjustment && selectedDef && (
          <div className="flex flex-col gap-3 p-4">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Properties · {selectedAdjustment.name}</div>
            {fieldsFromObjectSchema(selectedDef.paramSchema as unknown as z.ZodObject<z.ZodRawShape>).map((f) => (
              <ParamField
                key={f.key}
                id={f.key}
                label={f.label}
                value={(selectedAdjustment.params as Record<string, unknown>)[f.key]}
                schema={f.schema}
                onChange={(v) => setDoc((d) => setAdjustmentParam(d, selectedAdjustment.id, f.key, v))}
              />
            ))}
          </div>
        )}
      </aside>
      {palette && (
        <BehaviorPaletteSheet
          subjectKind="full_frame"
          onAdd={handleAdd}
          onClose={() => setPalette(false)}
        />
      )}
    </div>
  );
}

function FilterPreview({ doc }: { doc: FilterDoc }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new PreviewEngine(canvasRef.current);
    engineRef.current = engine;
    engine.start();
    loadSampleClips()
      .then((clips) => {
        const clip = clips.find((c) => c.id === doc.sampleClipId) ?? clips[0];
        if (clip) engine.setSource(VideoSource.fromSampleClip(clip));
      })
      .catch(() => undefined);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [doc.sampleClipId]);

  useEffect(() => {
    engineRef.current?.setScene({
      sampleClipId: doc.sampleClipId,
      subjects: [
        { id: "full", kind: "full_frame", name: "Full frame", visible: true, behaviors: doc.adjustments },
      ],
    });
  }, [doc]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <canvas ref={canvasRef} className="max-h-full max-w-full" />
    </div>
  );
}
