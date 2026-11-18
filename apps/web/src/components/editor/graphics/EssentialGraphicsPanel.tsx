import React, { useMemo, useRef, useState } from "react";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Group,
  Image as ImageIcon,
  Plus,
  Shapes,
  Type as TypeIcon,
  Trash2,
  Upload,
} from "lucide-react";
import {
  GRAPHIC_TEMPLATE_CATEGORIES,
  addLayer,
  alignLayers,
  distributeLayers,
  exposeProperty,
  pinToFrameEdge,
  protectedDurations,
  resolveLayerBoxes,
  removeParameter,
  reorderLayer,
  setLayerPin,
  updateLayer,
  updateParameter,
  type AlignMode,
  type GraphicInstance,
  type GraphicLayer,
  type GraphicParamProperty,
  type GraphicTemplate,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useGraphicTemplatesStore } from "../../../stores/graphic-templates-store";
import { toast } from "../../../stores/notification-store";
import { WorkspaceTabs, workspaceTabPanel } from "../WorkspacePrimitives";
import {
  downloadGraphicTemplate,
  editGraphicTemplateCommand,
  groupSelectionIntoGraphic,
  groupableSelectionCount,
  importGraphicTemplateFile,
  insertGraphic,
  selectedGraphicInstance,
} from "../../../services/graphic-commands";
import { GraphicTemplateThumb, templateCaption } from "./GraphicTemplateThumb";

const KIND_PROPERTIES: Record<GraphicLayer["kind"], Array<{ property: GraphicParamProperty; label: string }>> = {
  text: [
    { property: "text", label: "Text" },
    { property: "textColor", label: "Text color" },
    { property: "fontFamily", label: "Font" },
    { property: "fontSize", label: "Font size" },
  ],
  shape: [
    { property: "fill", label: "Fill color" },
    { property: "strokeColor", label: "Stroke color" },
    { property: "strokeWidth", label: "Stroke width" },
  ],
  svg: [{ property: "tint", label: "Tint color" }],
  image: [],
};
const COMMON_PROPERTIES: Array<{ property: GraphicParamProperty; label: string }> = [
  { property: "visible", label: "Show / hide layer" },
  { property: "position", label: "Position" },
  { property: "x", label: "X position" },
  { property: "y", label: "Y position" },
  { property: "width", label: "Width" },
  { property: "height", label: "Height" },
  { property: "opacity", label: "Opacity" },
  { property: "rotation", label: "Rotation" },
];

/** A fresh layer centred on the frame, with an id that is free in the template. */
function newLayer(template: GraphicTemplate, kind: GraphicLayer["kind"], image?: { src: string; aspect: number }): GraphicLayer {
  const taken = new Set(template.layers.map((layer) => layer.id));
  let n = 1;
  while (taken.has(`${kind}-${n}`)) n++;
  const id = `${kind}-${n}`;
  const base = { id, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`, kind, visible: true, x: 960, y: 540, rotation: 0, opacity: 1 } as const;
  if (kind === "text") {
    return { ...base, width: 600, height: 80, text: { text: "New text", style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#ffffff", textAlign: "center" } } };
  }
  if (kind === "image" && image) {
    const wide = image.aspect >= 1;
    return { ...base, width: wide ? 480 : 480 * image.aspect, height: wide ? 480 / image.aspect : 480, image };
  }
  return { ...base, width: 320, height: 120, shape: { shapeType: "rectangle", style: { fill: { type: "solid", color: "#3b82f6", opacity: 1 }, stroke: { color: "#000000", width: 0, opacity: 1 } } } };
}

const NumberField: React.FC<{ label: string; value: number; onCommit: (value: number) => void }> = ({ label, value, onCommit }) => {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const shown = String(Math.round(value * 100) / 100);
  React.useEffect(() => setDraft(shown), [shown]);
  return (
    <label className="flex items-center gap-1 text-[11px] text-fg-muted">
      {label}
      <Input
        aria-label={label}
        type="number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (Number.isFinite(next) && next !== value) onCommit(next);
          else setDraft(shown);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-6 w-[4.25rem] px-1.5 text-[11px]"
      />
    </label>
  );
};

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

const BrowseTab: React.FC = () => {
  const userTemplates = useGraphicTemplatesStore((state) => state.userTemplates);
  const removeUserTemplate = useGraphicTemplatesStore((state) => state.remove);
  const [category, setCategory] = useState<string>("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const hasProject = useProjectStore((state) => state.hasOpenProject);
  const project = useProjectStore((state) => state.project);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const groupable = useMemo(
    () => groupableSelectionCount(project, selectedItems.map((item) => item.id)),
    [project, selectedItems],
  );
  const templates = useMemo(
    () => [...useGraphicTemplatesStore.getState().list()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userTemplates],
  );
  const shown = templates.filter((template) => category === "all" || template.category === category);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const result = await importGraphicTemplateFile(file);
    if (result.ok) toast.success("Template imported", `"${result.template.name}" is under My templates.`);
    else toast.error("Template not imported", result.message);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="graphic-browse">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Template category">
        {[{ id: "all", name: "All" }, ...GRAPHIC_TEMPLATE_CATEGORIES].map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            aria-pressed={category === item.id}
            className={`h-6 px-2 text-[11px] ${category === item.id ? "bg-bg-3 text-fg" : "text-fg-muted"}`}
            onClick={() => setCategory(item.id)}
          >
            {item.name}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {shown.map((template) => {
          const isUser = userTemplates.some((item) => item.id === template.id);
          return (
            <div key={template.id} className={`group relative flex flex-col gap-1 min-w-0${template.category === "lower-third" ? " col-span-2" : ""}`} data-graphic-template={template.id}>
              <button
                type="button"
                aria-label={`Insert ${template.name}`}
                disabled={!hasProject}
                onClick={() => { void insertGraphic(template); }}
                className="rounded-[4px] border border-border/60 bg-bg-2 p-1 text-left transition hover:border-accent focus-visible:border-accent disabled:opacity-50"
              >
                <GraphicTemplateThumb template={template} wide={template.category === "lower-third"} />
                <span className="mt-1 block truncate text-[11px] font-medium text-fg">{template.name}</span>
                <span className="block truncate text-[10px] text-fg-muted">
                  {templateCaption(template)}
                </span>
              </button>
              {isUser && (
                <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex group-focus-within:flex">
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-5 w-5"
                    aria-label={`Export ${template.name}`}
                    onClick={() => downloadGraphicTemplate(template)}
                  >
                    <Upload size={11} aria-hidden />
                  </Button>
                  <Button
                    size="icon"
                    variant="secondary"
                    className="h-5 w-5"
                    aria-label={`Delete ${template.name}`}
                    onClick={() => removeUserTemplate(template.id)}
                  >
                    <Trash2 size={11} aria-hidden />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {shown.length === 0 && <p className="text-xs text-fg-muted">No templates in this category yet.</p>}
      <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
        <Button
          variant="outline"
          size="sm"
          className="justify-start gap-1.5"
          disabled={!hasProject || groupable === 0}
          title="Select text, shape or SVG clips on the timeline, then group them into one graphic with controls"
          onClick={() => { void groupSelectionIntoGraphic(); }}
        >
          <Group size={13} aria-hidden /> Group {groupable > 0 ? `${groupable} selected clip${groupable === 1 ? "" : "s"}` : "selected clips"} into a graphic
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".openreel-template,application/json"
          hidden
          data-testid="graphic-template-import"
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" className="justify-start gap-1.5" onClick={() => fileInput.current?.click()}>
          <Upload size={13} aria-hidden /> Import template…
        </Button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

const ALIGN_ACTIONS: Array<{ mode: AlignMode; label: string; icon: React.ReactNode }> = [
  { mode: "left", label: "Align left", icon: <AlignStartVertical size={13} /> },
  { mode: "center", label: "Align horizontal centers", icon: <AlignCenterVertical size={13} /> },
  { mode: "right", label: "Align right", icon: <AlignEndVertical size={13} /> },
  { mode: "top", label: "Align top", icon: <AlignStartHorizontal size={13} /> },
  { mode: "middle", label: "Align vertical centers", icon: <AlignCenterHorizontal size={13} /> },
  { mode: "bottom", label: "Align bottom", icon: <AlignEndHorizontal size={13} /> },
];

const PIN_EDGES: Array<{ value: string; label: string }> = [
  { value: "none", label: "Not pinned" },
  { value: "start", label: "Start edge" },
  { value: "center", label: "Centre" },
  { value: "end", label: "End edge" },
];

const EditTab: React.FC<{ instance: GraphicInstance }> = ({ instance }) => (
  <GraphicTemplateEditor
    template={instance.template}
    title={instance.name}
    onEdit={(label, fn) => { void editGraphicTemplateCommand(instance.id, label, fn); }}
  />
);

/**
 * Layer stack, align / pin and exposed-control editor for one template. Shared by
 * Essential Graphics > Edit (the template of the selected graphic) and the linked
 * composition window (the master template).
 */
export const GraphicTemplateEditor: React.FC<{
  template: GraphicTemplate;
  title: string;
  onEdit: (label: string, fn: (template: GraphicTemplate) => GraphicTemplate) => void;
}> = ({ template, title, onEdit }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const valid = selected.filter((id) => template.layers.some((layer) => layer.id === id));
  const layer = template.layers.find((item) => item.id === valid[0]);
  const box = useMemo(
    () => (layer ? resolveLayerBoxes(template.layers, { width: 1920, height: 1080 }).get(layer.id) : undefined),
    [template.layers, layer],
  );
  const { intro, outro, minDuration } = protectedDurations(template);
  const [exposeLabel, setExposeLabel] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);

  const addImageLayer = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      toast.warning("Image too large", "Template images are limited to 2 MB.");
      return;
    }
    const src = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(() => "");
    const dimensions = await new Promise<{ w: number; h: number }>((resolve) => {
      const image = new window.Image();
      image.onload = () => resolve({ w: image.naturalWidth || 1, h: image.naturalHeight || 1 });
      image.onerror = () => resolve({ w: 0, h: 0 });
      image.src = src;
    });
    if (!src || dimensions.w === 0) {
      toast.warning("Image not added", "That file could not be read as a PNG, JPEG, WebP or GIF image.");
      return;
    }
    const aspect = dimensions.w / dimensions.h;
    edit("Add image layer", (t) => addLayer(t, newLayer(t, "image", { src, aspect })));
  };

  const edit = onEdit;
  const toggleSelect = (id: string, additive: boolean) =>
    setSelected((current) => (additive ? (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]) : [id]));

  // Top layer first, like Premiere's layer stack.
  const ordered = template.layers.map((item, index) => ({ item, index })).reverse();
  const targetsForPin = template.layers.filter((item) => item.id !== layer?.id);

  const pinValue = (axis: "horizontal" | "vertical") => layer?.pin?.[axis]?.edge ?? "none";
  const pinTarget = (axis: "horizontal" | "vertical") => layer?.pin?.[axis]?.to ?? "frame";

  return (
    <div className="flex flex-col gap-4" data-testid="graphic-edit">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-fg truncate">{title}</h3>
        <p className="text-[11px] text-fg-muted" data-testid="graphic-protection">
          Intro {Math.round(intro * 100) / 100}s and outro {Math.round(outro * 100) / 100}s are protected. Shortest length {minDuration}s.
        </p>
      </header>

      <section aria-label="Layers" className="flex flex-col gap-1">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Layers</h4>
        <p className="text-[10px] text-fg-muted">
          Text draws above shapes and SVG art; order applies within each kind. Shift-click to select several.
        </p>
        <ul className="flex flex-col gap-0.5" data-testid="graphic-layer-list">
          {ordered.map(({ item, index }) => {
            const isSelected = valid.includes(item.id);
            return (
              <li
                key={item.id}
                data-graphic-layer={item.id}
                className={`flex items-center gap-1 rounded-[3px] border px-1 py-0.5 ${isSelected ? "border-accent bg-bg-3" : "border-transparent hover:bg-bg-2"}`}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0"
                  aria-label={`${item.visible ? "Hide" : "Show"} ${item.name}`}
                  onClick={() => edit(`${item.visible ? "Hide" : "Show"} layer`, (t) => updateLayer(t, item.id, { visible: !item.visible }))}
                >
                  {item.visible ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
                </Button>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  className="min-w-0 flex-1 truncate text-left text-xs text-fg"
                  onClick={(event) => toggleSelect(item.id, event.shiftKey || event.metaKey || event.ctrlKey)}
                >
                  {item.name} <span className="text-[10px] text-fg-muted">{item.kind}</span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0"
                  aria-label={`Move ${item.name} up`}
                  disabled={index === template.layers.length - 1}
                  onClick={() => edit("Reorder layer", (t) => reorderLayer(t, item.id, index + 1))}
                >
                  <ArrowUp size={12} aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 shrink-0"
                  aria-label={`Move ${item.name} down`}
                  disabled={index === 0}
                  onClick={() => edit("Reorder layer", (t) => reorderLayer(t, item.id, index - 1))}
                >
                  <ArrowDown size={12} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label="Add layer" className="flex flex-wrap items-center gap-1">
        <Button size="sm" variant="outline" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => edit("Add text layer", (t) => addLayer(t, newLayer(t, "text")))}>
          <TypeIcon size={11} aria-hidden /> Text
        </Button>
        <Button size="sm" variant="outline" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => edit("Add shape layer", (t) => addLayer(t, newLayer(t, "shape")))}>
          <Shapes size={11} aria-hidden /> Shape
        </Button>
        <Button size="sm" variant="outline" className="h-6 gap-1 px-1.5 text-[11px]" onClick={() => imageInput.current?.click()}>
          <ImageIcon size={11} aria-hidden /> Image…
        </Button>
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          data-testid="graphic-image-input"
          onChange={(event) => {
            void addImageLayer(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </section>

      <section aria-label="Align and distribute" className="flex flex-col gap-1.5">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Align and distribute</h4>
        <div className="flex flex-wrap gap-1">
          {ALIGN_ACTIONS.map((action) => (
            <Button
              key={action.mode}
              size="icon"
              variant="outline"
              className="h-6 w-6"
              aria-label={action.label}
              title={`${action.label} (${valid.length > 1 ? "to selection" : "to frame"})`}
              disabled={valid.length === 0}
              onClick={() => edit("Align layers", (t) => alignLayers(t, valid, action.mode, valid.length > 1 ? "selection" : "frame"))}
            >
              {action.icon}
            </Button>
          ))}
          <Button
            size="icon"
            variant="outline"
            className="h-6 w-6"
            aria-label="Distribute horizontally"
            disabled={valid.length < 3}
            onClick={() => edit("Distribute layers", (t) => distributeLayers(t, valid, "horizontal"))}
          >
            <AlignHorizontalSpaceBetween size={13} />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-6 w-6"
            aria-label="Distribute vertically"
            disabled={valid.length < 3}
            onClick={() => edit("Distribute layers", (t) => distributeLayers(t, valid, "vertical"))}
          >
            <AlignVerticalSpaceBetween size={13} />
          </Button>
        </div>
      </section>

      {layer ? (
        <>
          <section aria-label="Layer geometry" className="flex flex-col gap-1.5">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">{layer.name}</h4>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {/* Pinned layers show where the pin puts them; typing a position releases that axis' pin. */}
              <NumberField
                label="X"
                value={box?.cx ?? layer.x}
                onCommit={(x) => edit("Move layer", (t) => updateLayer(setLayerPin(t, layer.id, "horizontal", null), layer.id, { x }))}
              />
              <NumberField
                label="Y"
                value={box?.cy ?? layer.y}
                onCommit={(y) => edit("Move layer", (t) => updateLayer(setLayerPin(t, layer.id, "vertical", null), layer.id, { y }))}
              />
              <NumberField label="W" value={layer.width} onCommit={(width) => edit("Resize layer", (t) => updateLayer(t, layer.id, { width: Math.max(1, width) }))} />
              <NumberField label="H" value={layer.height} onCommit={(height) => edit("Resize layer", (t) => updateLayer(t, layer.id, { height: Math.max(1, height) }))} />
            </div>
          </section>

          <section aria-label="Responsive design" className="flex flex-col gap-1.5" data-testid="graphic-pins">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Responsive design</h4>
            {(["horizontal", "vertical"] as const).map((axis) => {
              const edge = pinValue(axis);
              const pin = layer.pin?.[axis];
              return (
                <div key={axis} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-[4.25rem] text-[11px] text-fg-muted">Pin {axis === "horizontal" ? "horizontal" : "vertical"}</span>
                  <Select
                    value={edge}
                    onValueChange={(next) => {
                      if (next === "none") edit("Unpin layer", (t) => setLayerPin(t, layer.id, axis, null));
                      else edit("Pin layer", (t) => pinToFrameEdge(t, layer.id, axis, next as "start" | "center" | "end"));
                    }}
                  >
                    <SelectTrigger aria-label={`Pin ${axis}`} className="h-6 w-[6.5rem] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PIN_EDGES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {pin && (
                    <>
                      <Select
                        value={pinTarget(axis)}
                        onValueChange={(to) => edit("Pin layer", (t) => setLayerPin(t, layer.id, axis, { ...pin, to }))}
                      >
                        <SelectTrigger aria-label={`Pin ${axis} to`} className="h-6 w-[6.5rem] text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="frame">Video frame</SelectItem>
                          {targetsForPin.map((other) => (
                            <SelectItem key={other.id} value={other.id}>{other.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <NumberField
                        label="Offset"
                        value={pin.offset}
                        onCommit={(offset) => edit("Pin layer", (t) => setLayerPin(t, layer.id, axis, { ...pin, offset }))}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </section>

          <section aria-label="Expose controls" className="flex flex-col gap-1.5">
            <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Expose as control</h4>
            <Input
              aria-label="Control name"
              placeholder="Control name (optional)"
              value={exposeLabel}
              onChange={(event) => setExposeLabel(event.target.value)}
              className="h-6 text-[11px]"
            />
            <div className="flex flex-wrap gap-1">
              {[...KIND_PROPERTIES[layer.kind], ...COMMON_PROPERTIES].map(({ property, label }) => (
                <Button
                  key={property}
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 px-1.5 text-[11px]"
                  aria-label={`Expose ${label}`}
                  onClick={() => {
                    edit("Expose control", (t) =>
                      exposeProperty(t, layer.id, property, { label: exposeLabel || `${layer.name} ${label.toLowerCase()}`, group: layer.name }),
                    );
                    setExposeLabel("");
                  }}
                >
                  <Plus size={10} aria-hidden /> {label}
                </Button>
              ))}
            </div>
          </section>
        </>
      ) : (
        <p className="text-[11px] text-fg-muted">Select a layer to edit its position, pinning and exposed controls.</p>
      )}

      <section aria-label="Controls" className="flex flex-col gap-1.5" data-testid="graphic-param-list">
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Exposed controls</h4>
        {template.parameters.length === 0 && <p className="text-[11px] text-fg-muted">Nothing exposed yet.</p>}
        {template.parameters.map((parameter) => (
          <div key={parameter.id} className="flex items-center gap-1" data-param-row={parameter.id}>
            <Input
              aria-label={`Name of control ${parameter.label}`}
              defaultValue={parameter.label}
              key={`${parameter.id}:${parameter.label}`}
              onBlur={(event) => {
                const label = event.target.value.trim();
                if (label && label !== parameter.label) edit("Rename control", (t) => updateParameter(t, parameter.id, { label }));
              }}
              className="h-6 min-w-0 flex-1 text-[11px]"
            />
            <Input
              aria-label={`Group of control ${parameter.label}`}
              placeholder="Group"
              defaultValue={parameter.group ?? ""}
              key={`${parameter.id}:g:${parameter.group ?? ""}`}
              onBlur={(event) => {
                const group = event.target.value.trim();
                if (group !== (parameter.group ?? "")) edit("Group control", (t) => updateParameter(t, parameter.id, { group: group || undefined }));
              }}
              className="h-6 w-20 text-[11px]"
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              aria-label={`Remove control ${parameter.label}`}
              onClick={() => edit("Remove control", (t) => removeParameter(t, parameter.id))}
            >
              <Trash2 size={11} aria-hidden />
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export const EssentialGraphicsPanel: React.FC = () => {
  const [tab, setTab] = useState<"browse" | "edit">("browse");
  const project = useProjectStore((state) => state.project);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const instance = useMemo(
    () =>
      project.graphicInstances?.length
        ? selectedGraphicInstance(project, selectedItems.map((item) => item.id))
        : undefined,
    [project, selectedItems],
  );
  return (
    <div className="flex flex-col gap-3 min-w-0" data-testid="essential-graphics">
      <WorkspaceTabs
        label="Essential Graphics"
        value={tab}
        onChange={(value) => setTab(value as "browse" | "edit")}
        options={[
          { value: "browse", label: "Browse" },
          { value: "edit", label: "Edit" },
        ]}
      />
      <div {...workspaceTabPanel("Essential Graphics", tab)} className="min-w-0">
        {tab === "browse" ? (
          <BrowseTab />
        ) : instance ? (
          <EditTab key={instance.id} instance={instance} />
        ) : (
          <p className="text-xs text-fg-muted" data-testid="graphic-edit-empty">
            Select a graphic on the timeline to edit its layers, align and pin them, and choose which properties become controls.
          </p>
        )}
      </div>
    </div>
  );
};
