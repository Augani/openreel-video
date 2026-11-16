import React, { useState } from "react";
import { Button, Input } from "@openreel/ui";
import { Download, ExternalLink, Link2, Link2Off, Save, Unlink, Undo2, Clapperboard } from "lucide-react";
import { graphicInstanceToTemplate, isBakeStale, protectedDurations, type GraphicInstance } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import {
  detachLinkedCompositionCommand,
  openLinkedCompositionWindow,
  restoreUnrenderedCommand,
} from "../../../services/linked-comp-commands";
import { renderAndReplaceCommand } from "../../../services/linked-comp-render";
import { GraphicParameterControls } from "./GraphicParameterControls";
import {
  downloadGraphicTemplate,
  saveGraphicAsTemplate,
  ungroupGraphicCommand,
} from "../../../services/graphic-commands";

const seconds = (value: number): string => `${Math.round(value * 100) / 100}s`;

/**
 * Inspector for a selected graphic: only the controls the template author exposed,
 * plus save / export / ungroup. Layer-level editing lives in Essential Graphics > Edit.
 */
export const GraphicInspector: React.FC<{ instance: GraphicInstance }> = ({ instance }) => {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const { intro, outro, minDuration } = protectedDurations(instance.template);
  const project = useProjectStore((state) => state.project);
  const [rendering, setRendering] = useState(false);
  const linked = instance.linkedCompositionId;

  if (instance.bake) {
    const stale = isBakeStale(project, instance);
    return (
      <div className="flex flex-col gap-3 p-3" data-testid="linked-baked-inspector" data-graphic-id={instance.id}>
        <header className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-fg truncate" title={instance.name}>{instance.name}</h3>
          <p className="flex items-center gap-1 text-[11px] text-fg-muted"><Clapperboard size={12} aria-hidden /> Rendered linked composition</p>
        </header>
        <p className="text-xs text-fg-muted">
          This clip is the rendered picture of the composition. Restore Unrendered brings the live layers back so you can edit them again.
        </p>
        {stale && (
          <p role="status" className="text-xs text-warning" data-testid="linked-stale">
            The composition was edited after this render, so the picture is out of date.
          </p>
        )}
        <Button size="sm" className="justify-start gap-2" data-testid="restore-unrendered" onClick={() => { void restoreUnrenderedCommand(instance.id); }}>
          <Undo2 size={13} aria-hidden /> Restore Unrendered
        </Button>
      </div>
    );
  }

  const save = () => {
    saveGraphicAsTemplate(instance.id, name.trim() || `${instance.name} (custom)`);
    setNaming(false);
    setName("");
  };

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="graphic-inspector" data-graphic-id={instance.id}>
      <header className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-fg truncate" title={instance.name}>{instance.name}</h3>
        <p className="text-[11px] text-fg-muted">
          {instance.template.layers.length} layers · {seconds(instance.duration)} · in {seconds(intro)} · out {seconds(outro)}
        </p>
        <p className="text-[11px] text-fg-muted">
          Stretching keeps the intro and outro intact; shortest length {seconds(minDuration)}.
        </p>
      </header>

      {linked && (
        <div className="flex flex-col gap-2 rounded border border-border/60 p-2" data-testid="linked-composition-actions">
          <p className="flex items-center gap-1 text-[11px] text-fg-muted"><Link2 size={12} aria-hidden /> Linked composition: edits made in its window update every instance.</p>
          <Button size="sm" className="justify-start gap-2" data-testid="open-linked-composition" onClick={() => { void openLinkedCompositionWindow(linked); }}>
            <ExternalLink size={13} aria-hidden /> Open composition
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-2"
            data-testid="render-and-replace"
            disabled={rendering}
            onClick={() => {
              setRendering(true);
              void renderAndReplaceCommand(instance.id).finally(() => setRendering(false));
            }}
          >
            <Clapperboard size={13} aria-hidden /> {rendering ? "Rendering…" : "Render and Replace"}
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2 text-fg-muted" onClick={() => { void detachLinkedCompositionCommand(instance.id); }}>
            <Link2Off size={13} aria-hidden /> Unlink from composition
          </Button>
        </div>
      )}

      <GraphicParameterControls instance={instance} />

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        {naming ? (
          <div className="flex items-center gap-1.5">
            <Input
              autoFocus
              aria-label="Template name"
              placeholder={`${instance.name} (custom)`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
                if (event.key === "Escape") setNaming(false);
              }}
              className="h-7 text-xs"
            />
            <Button size="sm" onClick={save}>Save</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="justify-start gap-2" onClick={() => setNaming(true)}>
            <Save size={13} aria-hidden /> Save as template…
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-2"
          onClick={() => downloadGraphicTemplate(graphicInstanceToTemplate(instance, { name: instance.name }))}
        >
          <Download size={13} aria-hidden /> Export .openreel-template
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start gap-2 text-fg-muted"
          title="Turn the layers into ordinary clips you can edit one by one"
          onClick={() => { void ungroupGraphicCommand(instance.id); }}
        >
          <Unlink size={13} aria-hidden /> Ungroup layers
        </Button>
      </div>
    </div>
  );
};
