/**
 * Pure template-edit helpers behind Essential Graphics > Edit: reorder, align,
 * distribute, pin, layer toggles and exposing properties as controls. Each takes
 * and returns a GraphicTemplate; commit them with `editGraphicTemplate`.
 */
import {
  GRAPHIC_DESIGN_HEIGHT,
  GRAPHIC_DESIGN_WIDTH,
  type GraphicAxisPin,
  type GraphicLayer,
  type GraphicParamProperty,
  type GraphicParamType,
  type GraphicParamValue,
  type GraphicParameter,
  type GraphicTemplate,
} from "./types";

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type AlignTarget = "frame" | "selection";
export type DistributeAxis = "horizontal" | "vertical";

const withLayers = (template: GraphicTemplate, layers: readonly GraphicLayer[]): GraphicTemplate => ({ ...template, layers });

function mapLayers(
  template: GraphicTemplate,
  ids: ReadonlySet<string>,
  fn: (layer: GraphicLayer) => GraphicLayer,
): GraphicTemplate {
  return withLayers(template, template.layers.map((layer) => (ids.has(layer.id) ? fn(layer) : layer)));
}

/** Without a pin on that axis the stored x / y is what is drawn. */
const clearAxisPin = (layer: GraphicLayer, axis: "horizontal" | "vertical"): GraphicLayer => {
  if (!layer.pin?.[axis]) return layer;
  const { [axis]: _removed, ...rest } = layer.pin;
  void _removed;
  return { ...layer, pin: Object.keys(rest).length ? rest : undefined };
};

export function updateLayer(template: GraphicTemplate, layerId: string, patch: Partial<GraphicLayer>): GraphicTemplate {
  const { id: _ignored, kind: _kind, ...safe } = patch;
  void _ignored;
  void _kind;
  const updated = mapLayers(template, new Set([layerId]), (layer) => ({ ...layer, ...safe }));
  if (typeof safe.visible !== "boolean" || !template.layers.some((layer) => layer.id === layerId)) return updated;
  // A checkbox control that drives only this layer's visibility overrides the layer's own flag on every
  // instance, so showing or hiding the layer in the master must move the control's default with it.
  const visible = safe.visible;
  const driven = (parameter: GraphicParameter): boolean =>
    parameter.type === "checkbox" &&
    parameter.targets.length === 1 &&
    parameter.targets[0].layerId === layerId &&
    parameter.targets[0].property === "visible" &&
    parameter.defaultValue !== visible;
  if (!updated.parameters.some(driven)) return updated;
  return { ...updated, parameters: updated.parameters.map((parameter) => (driven(parameter) ? { ...parameter, defaultValue: visible } : parameter)) };
}

export function renameLayer(template: GraphicTemplate, layerId: string, name: string): GraphicTemplate {
  return updateLayer(template, layerId, { name: name.slice(0, 120) });
}

/** Move a layer to `toIndex` in the bottom-to-top stack. */
export function reorderLayer(template: GraphicTemplate, layerId: string, toIndex: number): GraphicTemplate {
  const from = template.layers.findIndex((layer) => layer.id === layerId);
  if (from < 0) return template;
  const target = Math.max(0, Math.min(template.layers.length - 1, Math.round(toIndex)));
  if (target === from) return template;
  const layers = template.layers.slice();
  const [moved] = layers.splice(from, 1);
  layers.splice(target, 0, moved);
  return withLayers(template, layers);
}

export function removeLayer(template: GraphicTemplate, layerId: string): GraphicTemplate {
  if (template.layers.length <= 1) return template;
  const layers = template.layers
    .filter((layer) => layer.id !== layerId)
    .map((layer) => {
      // Pins to the removed layer fall back to the frame at the same distance.
      const repoint = (pin: GraphicAxisPin | undefined) => (pin && pin.to === layerId ? { ...pin, to: "frame" } : pin);
      if (!layer.pin) return layer;
      return { ...layer, pin: { horizontal: repoint(layer.pin.horizontal), vertical: repoint(layer.pin.vertical) } };
    });
  const parameters = template.parameters
    .map((parameter) => ({ ...parameter, targets: parameter.targets.filter((target) => target.layerId !== layerId) }))
    .filter((parameter) => parameter.targets.length > 0);
  return { ...template, layers, parameters };
}

export function duplicateLayer(template: GraphicTemplate, layerId: string): GraphicTemplate {
  const index = template.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return template;
  const source = template.layers[index];
  let n = 2;
  const taken = new Set(template.layers.map((layer) => layer.id));
  while (taken.has(`${source.id}-${n}`)) n++;
  const copy: GraphicLayer = { ...source, id: `${source.id}-${n}`, name: `${source.name} copy`, x: source.x + 24, y: source.y + 24 };
  const layers = template.layers.slice();
  layers.splice(index + 1, 0, copy);
  return withLayers(template, layers);
}

export function addLayer(template: GraphicTemplate, layer: GraphicLayer): GraphicTemplate {
  if (template.layers.some((existing) => existing.id === layer.id)) return template;
  return withLayers(template, [...template.layers, layer]);
}

export function setLayerVisible(template: GraphicTemplate, layerId: string, visible: boolean): GraphicTemplate {
  return updateLayer(template, layerId, { visible });
}

interface Rect { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
const rectOf = (layer: GraphicLayer): Rect => ({
  left: layer.x - layer.width / 2, right: layer.x + layer.width / 2,
  top: layer.y - layer.height / 2, bottom: layer.y + layer.height / 2,
});

/** Align layers to the 1920x1080 frame or to the selection's bounds. Clears the pin on the moved axis. */
export function alignLayers(
  template: GraphicTemplate,
  layerIds: readonly string[],
  mode: AlignMode,
  target: AlignTarget = "frame",
): GraphicTemplate {
  const ids = new Set(layerIds);
  const chosen = template.layers.filter((layer) => ids.has(layer.id));
  if (chosen.length === 0) return template;
  let bounds: Rect = { left: 0, right: GRAPHIC_DESIGN_WIDTH, top: 0, bottom: GRAPHIC_DESIGN_HEIGHT };
  if (target === "selection") {
    const rects = chosen.map(rectOf);
    bounds = {
      left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  }
  return mapLayers(template, ids, (layer) => {
    switch (mode) {
      case "left": return { ...clearAxisPin(layer, "horizontal"), x: bounds.left + layer.width / 2 };
      case "center": return { ...clearAxisPin(layer, "horizontal"), x: (bounds.left + bounds.right) / 2 };
      case "right": return { ...clearAxisPin(layer, "horizontal"), x: bounds.right - layer.width / 2 };
      case "top": return { ...clearAxisPin(layer, "vertical"), y: bounds.top + layer.height / 2 };
      case "middle": return { ...clearAxisPin(layer, "vertical"), y: (bounds.top + bounds.bottom) / 2 };
      case "bottom": return { ...clearAxisPin(layer, "vertical"), y: bounds.bottom - layer.height / 2 };
    }
  });
}

/** Even gaps between three or more layers, keeping the outermost two where they are. */
export function distributeLayers(
  template: GraphicTemplate,
  layerIds: readonly string[],
  axis: DistributeAxis,
): GraphicTemplate {
  const ids = new Set(layerIds);
  const chosen = template.layers.filter((layer) => ids.has(layer.id));
  if (chosen.length < 3) return template;
  const horizontal = axis === "horizontal";
  const size = (layer: GraphicLayer): number => (horizontal ? layer.width : layer.height);
  const centre = (layer: GraphicLayer): number => (horizontal ? layer.x : layer.y);
  const ordered = chosen.slice().sort((a, b) => centre(a) - centre(b));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const start = centre(first) - size(first) / 2;
  const end = centre(last) + size(last) / 2;
  const total = ordered.reduce((sum, layer) => sum + size(layer), 0);
  const gap = (end - start - total) / (ordered.length - 1);
  const placed = new Map<string, number>();
  let cursor = start;
  for (const layer of ordered) {
    placed.set(layer.id, cursor + size(layer) / 2);
    cursor += size(layer) + gap;
  }
  return mapLayers(template, ids, (layer) => {
    const value = placed.get(layer.id);
    if (value === undefined) return layer;
    return horizontal ? { ...clearAxisPin(layer, "horizontal"), x: value } : { ...clearAxisPin(layer, "vertical"), y: value };
  });
}

/** Pin (or unpin with `null`) a layer on one axis. A pin to a layer that is itself pinned back to this one is refused. */
export function setLayerPin(
  template: GraphicTemplate,
  layerId: string,
  axis: "horizontal" | "vertical",
  pin: GraphicAxisPin | null,
): GraphicTemplate {
  if (pin && pin.to !== "frame") {
    if (pin.to === layerId) return template;
    // Reject cycles: following `to` from the target must never come back here.
    const byId = new Map(template.layers.map((layer) => [layer.id, layer]));
    let cursor: string | undefined = pin.to;
    const seen = new Set<string>();
    while (cursor && cursor !== "frame" && !seen.has(cursor)) {
      if (cursor === layerId) return template;
      seen.add(cursor);
      const next: GraphicAxisPin | undefined = byId.get(cursor)?.pin?.[axis];
      cursor = next?.to;
    }
  }
  return mapLayers(template, new Set([layerId]), (layer) => {
    const current = { ...(layer.pin ?? {}) };
    if (pin) current[axis] = pin;
    else delete current[axis];
    return { ...layer, pin: Object.keys(current).length ? current : undefined };
  });
}

/** Pin to the nearest frame edge at the current distance (Premiere's "pin to the video frame"). */
export function pinToFrameEdge(template: GraphicTemplate, layerId: string, axis: "horizontal" | "vertical", edge: "start" | "end" | "center"): GraphicTemplate {
  const layer = template.layers.find((item) => item.id === layerId);
  if (!layer) return template;
  const rect = rectOf(layer);
  const offset = axis === "horizontal"
    ? edge === "start" ? rect.left : edge === "end" ? GRAPHIC_DESIGN_WIDTH - rect.right : layer.x - GRAPHIC_DESIGN_WIDTH / 2
    : edge === "start" ? rect.top : edge === "end" ? GRAPHIC_DESIGN_HEIGHT - rect.bottom : layer.y - GRAPHIC_DESIGN_HEIGHT / 2;
  return setLayerPin(template, layerId, axis, { edge, to: "frame", offset: Math.round(offset * 100) / 100 });
}

// ---------------------------------------------------------------------------
// Exposed controls
// ---------------------------------------------------------------------------

const DEFAULT_TYPE: Record<GraphicParamProperty, GraphicParamType> = {
  text: "text", textColor: "color", fontFamily: "font", fontSize: "slider", fontWeight: "slider",
  fill: "color", strokeColor: "color", strokeWidth: "slider", tint: "color", visible: "checkbox",
  x: "slider", y: "slider", position: "position", width: "slider", height: "slider", opacity: "slider", rotation: "slider",
};

/** Current value of a layer property in the form a control would hold. */
export function readLayerProperty(layer: GraphicLayer, property: GraphicParamProperty): GraphicParamValue | undefined {
  switch (property) {
    case "text": return layer.text?.text;
    case "textColor": return layer.text?.style.color ?? "#ffffff";
    case "fontFamily": return layer.text?.style.fontFamily ?? "Inter";
    case "fontSize": return layer.text?.style.fontSize ?? 48;
    case "fontWeight": return typeof layer.text?.style.fontWeight === "number" ? layer.text.style.fontWeight : 700;
    case "fill": return layer.shape?.style.fill?.color ?? "#3b82f6";
    case "strokeColor": return layer.shape?.style.stroke?.color ?? "#ffffff";
    case "strokeWidth": return layer.shape?.style.stroke?.width ?? 0;
    case "tint": return layer.svg?.tintColor ?? "#ffffff";
    case "visible": return layer.visible;
    case "x": return layer.x;
    case "y": return layer.y;
    case "position": return { x: layer.x, y: layer.y };
    case "width": return layer.width;
    case "height": return layer.height;
    case "opacity": return layer.opacity;
    case "rotation": return layer.rotation;
  }
}

const SLIDER_RANGE: Partial<Record<GraphicParamProperty, { min: number; max: number; step: number }>> = {
  fontSize: { min: 8, max: 400, step: 1 },
  fontWeight: { min: 100, max: 900, step: 100 },
  strokeWidth: { min: 0, max: 40, step: 1 },
  x: { min: -200, max: 2120, step: 1 },
  y: { min: -200, max: 1280, step: 1 },
  width: { min: 1, max: 2400, step: 1 },
  height: { min: 1, max: 1400, step: 1 },
  opacity: { min: 0, max: 1, step: 0.01 },
  rotation: { min: -360, max: 360, step: 1 },
};

/** Add (or extend) a control exposing `property` of `layerId`. Id is unique within the template. */
export function exposeProperty(
  template: GraphicTemplate,
  layerId: string,
  property: GraphicParamProperty,
  options: { readonly label?: string; readonly group?: string } = {},
): GraphicTemplate {
  const layer = template.layers.find((item) => item.id === layerId);
  if (!layer) return template;
  const current = readLayerProperty(layer, property);
  if (current === undefined) return template;
  const type = DEFAULT_TYPE[property];
  const taken = new Set(template.parameters.map((parameter) => parameter.id));
  const base = `${layerId}-${property}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const range = SLIDER_RANGE[property];
  const parameter: GraphicParameter = {
    id,
    label: options.label?.trim() || `${layer.name || layer.id} ${property}`,
    ...(options.group ? { group: options.group } : {}),
    type,
    defaultValue: current,
    ...(range && (type === "slider" || type === "number") ? range : {}),
    targets: [{ layerId, property }],
  };
  return { ...template, parameters: [...template.parameters, parameter] };
}

export function removeParameter(template: GraphicTemplate, parameterId: string): GraphicTemplate {
  return { ...template, parameters: template.parameters.filter((parameter) => parameter.id !== parameterId) };
}

export function updateParameter(
  template: GraphicTemplate,
  parameterId: string,
  patch: Partial<Pick<GraphicParameter, "label" | "group" | "min" | "max" | "step" | "options">>,
): GraphicTemplate {
  return {
    ...template,
    parameters: template.parameters.map((parameter) => (parameter.id === parameterId ? { ...parameter, ...patch } : parameter)),
  };
}

/** Controls grouped for display, in template order; ungrouped controls first. */
export function groupParameters(
  parameters: readonly GraphicParameter[],
): Array<{ readonly group: string | undefined; readonly parameters: GraphicParameter[] }> {
  const groups = new Map<string | undefined, GraphicParameter[]>();
  for (const parameter of parameters) {
    const list = groups.get(parameter.group);
    if (list) list.push(parameter);
    else groups.set(parameter.group, [parameter]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === undefined ? -1 : b === undefined ? 1 : 0));
  return ordered.map(([group, list]) => ({ group, parameters: list }));
}
