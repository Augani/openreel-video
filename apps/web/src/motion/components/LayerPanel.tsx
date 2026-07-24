import type { JSX } from "react";
import { useState, type ReactNode } from "react";
import {
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clapperboard,
  Clock,
  Film,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  Ruler,
  Search,
  SlidersHorizontal,
  MousePointerClick,
  Pencil,
  Shuffle,
  Sparkles,
  StretchHorizontal,
  StretchVertical,
  Square,
  Star,
  Trash2,
  Type,
  Unlock,
  VenetianMask,
  Box,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { ToolcraftTextInputControl } from "@openreel/ui";
import {
  alignMotionLayers,
  canNestMotionComposition,
  canParentMotionLayer,
  createMotionAdjustmentLayer,
  createMotionNullLayer,
  createMotionParticleLayer,
  clearMotionLayerParents,
  createMotionNullControllerForLayers,
  DEFAULT_MOTION_TRANSFORM,
  DEFAULT_SHAPE_STYLE,
  distributeMotionLayers,
  duplicateMotionLayers,
  getMotionLayerPropertyKeyframes,
  getMotionLayerPropertyValueAtTime,
  MOTION_BLEND_MODE_OPTIONS,
  groupMotionLayers,
  ungroupMotionLayers,
  setMotionGroupAutoLayout,
  addMotionComponentInstance,
  disintegrateMotionLayer,
  createCursorClick,
  morphMotionLayers,
  parentMotionLayers,
  precomposeMotionLayers,
  removeMotionLayerPropertyKeyframes,
  removeMotionLayers,
  upsertMotionLayerKeyframe,
  type BlendMode,
  type MotionAnimatableProperty,
  type MotionComposition,
  type MotionLayerAlignment,
  type MotionLayerDistributionAxis,
  type MotionLayer,
  type MotionLayerType,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { formatMotionTimecode } from "../motion-timecode";
import { MOTION_LAYER_LABEL_COLORS } from "../motion-layer-labels";
import { Button, EmptyState, IconButton, SelectInput } from "./primitives";

interface LayerPanelProps {
  composition: MotionComposition;
}

interface LayerContextMenuState {
  readonly layerId: string;
  readonly x: number;
  readonly y: number;
}

const makeId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

const LAYER_META: Record<
  MotionLayerType,
  { icon: LucideIcon; rail: string; tint: string }
> = {
  text: { icon: Type, rail: "bg-[var(--c-text)]", tint: "text-[var(--c-text)]" },
  shape: { icon: Star, rail: "bg-accent", tint: "text-accent" },
  image: { icon: ImageIcon, rail: "bg-[var(--c-video)]", tint: "text-[var(--c-video)]" },
  video: { icon: Film, rail: "bg-[var(--c-video)]", tint: "text-[var(--c-video)]" },
  group: { icon: Layers, rail: "bg-[var(--c-music)]", tint: "text-[var(--c-music)]" },
  null: { icon: Crosshair, rail: "bg-accent", tint: "text-accent" },
  composition: { icon: Clapperboard, rail: "bg-status-info", tint: "text-status-info" },
  adjustment: { icon: SlidersHorizontal, rail: "bg-status-warning", tint: "text-status-warning" },
  particle: { icon: Sparkles, rail: "bg-status-info", tint: "text-status-info" },
  scene3d: { icon: Box, rail: "bg-accent", tint: "text-accent" },
};

const LAYER_TABLE_COLUMNS = "1.5rem minmax(7rem,1fr) 5.4rem 5rem 4.6rem 4.6rem";

interface SummaryProperty {
  key: string;
  label: string;
  props: MotionAnimatableProperty[];
  format: (values: number[]) => string;
}

const SUMMARY_PROPERTIES: readonly SummaryProperty[] = [
  {
    key: "position",
    label: "Position",
    props: ["transform.position.x", "transform.position.y"],
    format: (values) => `${values[0].toFixed(1)}, ${values[1].toFixed(1)}`,
  },
  {
    key: "scale",
    label: "Scale",
    props: ["transform.scale.x", "transform.scale.y"],
    format: (values) =>
      `${(values[0] * 100).toFixed(1)}, ${(values[1] * 100).toFixed(1)}%`,
  },
  {
    key: "rotation",
    label: "Rotation",
    props: ["transform.rotation"],
    format: (values) => `${values[0].toFixed(1)}°`,
  },
  {
    key: "opacity",
    label: "Opacity",
    props: ["transform.opacity"],
    format: (values) => `${Math.round(values[0] * 100)}%`,
  },
];

export function LayerPanel({ composition }: LayerPanelProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [contextMenu, setContextMenu] =
    useState<LayerContextMenuState | null>(null);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setSelectedLayers = useMotionStore((state) => state.setSelectedLayers);
  const toggleLayerSelection = useMotionStore((state) => state.toggleLayerSelection);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const openComposition = useMotionStore((state) => state.openComposition);
  const playhead = useMotionStore((state) => state.playhead);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const timelineColumnMode = useMotionStore((state) => state.timelineColumnMode);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const createMotionComposition = useProjectStore(
    (state) => state.createMotionComposition,
  );
  const motionCompositions = useProjectStore(
    (state) => state.project.motionCompositions ?? [],
  );

  const updateLayers = (layers: MotionLayer[]) => {
    void upsertMotionComposition({ ...composition, layers, modifiedAt: Date.now() });
  };

  const updateComposition = (nextComposition: MotionComposition) => {
    if (nextComposition !== composition) {
      void upsertMotionComposition(nextComposition);
    }
  };

  const firstSelectedLayer = (
    predicate: (layer: MotionLayer) => boolean,
  ): MotionLayer | undefined => {
    for (const id of selectedLayerIds) {
      const layer = composition.layers.find((candidate) => candidate.id === id);
      if (layer && predicate(layer)) return layer;
    }
    return undefined;
  };

  const setSelectionAutoLayout = (
    autoLayout: { direction: "horizontal" | "vertical"; gap: number; align: "start" | "center" | "end" } | null,
  ) => {
    const group = firstSelectedLayer((layer) => layer.type === "group");
    if (!group) return;
    updateComposition(setMotionGroupAutoLayout(composition, group.id, autoLayout));
  };

  const addInstanceOfSelection = () => {
    const instance = firstSelectedLayer((layer) => layer.type === "composition");
    if (!instance) return;
    const result = addMotionComponentInstance(composition, instance.id);
    if (!result) return;
    updateComposition(result.composition);
    setSelectedLayers([result.instanceLayerId]);
  };

  const addTextLayer = () => {
    const layer: MotionLayer = {
      id: makeId("motion-layer"),
      type: "text",
      name: "Text Layer",
      startTime: 0,
      duration: composition.duration,
      visible: true,
      locked: false,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: composition.width / 2, y: composition.height / 2 },
      },
      keyframes: [],
      text: "New text",
      style: {
        fontFamily: "Inter",
        fontSize: 96,
        fontWeight: 800,
        color: "#ffffff",
        align: "center",
        lineHeight: 1.05,
      },
    };
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const addShapeLayer = () => {
    const layer: MotionLayer = {
      id: makeId("motion-layer"),
      type: "shape",
      name: "Shape Layer",
      startTime: 0,
      duration: composition.duration,
      visible: true,
      locked: false,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: composition.width / 2, y: composition.height / 2 },
      },
      keyframes: [],
      shapeType: "rectangle",
      width: 420,
      height: 220,
      style: {
        ...DEFAULT_SHAPE_STYLE,
        fill: { type: "solid", color: "#14b8a6", opacity: 1 },
        stroke: { color: "#0f766e", width: 0, opacity: 0 },
        cornerRadius: 20,
      },
    };
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const addParticleLayer = () => {
    const layer = createMotionParticleLayer(composition, { id: makeId("motion-layer") });
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const addAdjustmentLayer = () => {
    const layer = createMotionAdjustmentLayer({
      id: makeId("motion-layer"),
      duration: composition.duration,
      compositionWidth: composition.width,
      compositionHeight: composition.height,
    });
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const addGroupLayer = () => {
    const layer: MotionLayer = {
      id: makeId("motion-layer"),
      type: "group",
      name: "Group",
      startTime: 0,
      duration: composition.duration,
      visible: true,
      locked: false,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: composition.width / 2, y: composition.height / 2 },
      },
      keyframes: [],
      children: [],
    };
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const addNullLayer = () => {
    const layer = createMotionNullLayer(composition, { id: makeId("motion-layer") });
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const addPrecompLayer = async () => {
    let source = motionCompositions.find((candidate) =>
      canNestMotionComposition(motionCompositions, composition.id, candidate.id),
    );
    if (!source) {
      source = (await createMotionComposition("Nested Motion Scene")) ?? undefined;
    }
    if (!source || source.id === composition.id) return;

    const layer: MotionLayer = {
      id: makeId("motion-layer"),
      type: "composition",
      name: source.name,
      startTime: 0,
      duration: Math.min(composition.duration, source.duration),
      visible: true,
      locked: false,
      transform: {
        ...DEFAULT_MOTION_TRANSFORM,
        position: { x: composition.width / 2, y: composition.height / 2 },
      },
      keyframes: [],
      compositionId: source.id,
      width: source.width,
      height: source.height,
      timeOffset: 0,
      playbackRate: 1,
      fit: "contain",
    };
    updateLayers([...composition.layers, layer]);
    selectLayer(layer.id);
    setMenuOpen(false);
  };

  const patchLayer = (layerId: string, updates: Partial<MotionLayer>) => {
    updateLayers(
      composition.layers.map((layer) =>
        layer.id === layerId ? ({ ...layer, ...updates } as MotionLayer) : layer,
      ),
    );
  };

  const setSelectionLabelColor = (labelColor?: string) => {
    const targetIds =
      selectedLayerIds.length > 0
        ? new Set(selectedLayerIds)
        : new Set(contextMenu ? [contextMenu.layerId] : []);
    updateLayers(
      composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? ({ ...layer, labelColor } as MotionLayer)
          : layer,
      ),
    );
    setContextMenu(null);
  };

  const toggleLayerSolo = (layer: MotionLayer) => {
    patchLayer(layer.id, { solo: !layer.solo } as Partial<MotionLayer>);
  };

  const duplicateLayer = (layerId: string) => {
    const result = duplicateMotionLayers(composition, [layerId], {
      idFactory: () => makeId("motion-layer"),
      keyframeIdFactory: () => makeId("motion-kf"),
    });
    updateComposition(result.composition);
    setSelectedLayers(result.duplicatedLayerIds);
  };

  const duplicateSelection = () => {
    if (selectedLayerIds.length === 0) return;
    const result = duplicateMotionLayers(composition, selectedLayerIds, {
      idFactory: () => makeId("motion-layer"),
      keyframeIdFactory: () => makeId("motion-kf"),
    });
    updateComposition(result.composition);
    setSelectedLayers(result.duplicatedLayerIds);
  };

  const beginRename = (layer: MotionLayer) => {
    setRenamingLayerId(layer.id);
    setRenameValue(layer.name);
    setContextMenu(null);
  };

  const commitRename = () => {
    if (!renamingLayerId) return;
    const nextName = renameValue.trim();
    if (nextName) patchLayer(renamingLayerId, { name: nextName });
    setRenamingLayerId(null);
    setRenameValue("");
  };

  const moveLayer = (layerId: string, offset: number) => {
    const index = composition.layers.findIndex((layer) => layer.id === layerId);
    if (index < 0) return;
    const targetIndex = Math.min(
      composition.layers.length - 1,
      Math.max(0, index + offset),
    );
    if (targetIndex === index) return;
    const nextLayers = [...composition.layers];
    const [layer] = nextLayers.splice(index, 1);
    nextLayers.splice(targetIndex, 0, layer);
    updateLayers(nextLayers);
  };

  const reorderLayer = (draggedLayerId: string, targetLayerId: string) => {
    if (draggedLayerId === targetLayerId) return;
    const fromIndex = composition.layers.findIndex(
      (layer) => layer.id === draggedLayerId,
    );
    const targetIndex = composition.layers.findIndex(
      (layer) => layer.id === targetLayerId,
    );
    if (fromIndex < 0 || targetIndex < 0) return;
    const nextLayers = [...composition.layers];
    const [moved] = nextLayers.splice(fromIndex, 1);
    nextLayers.splice(targetIndex, 0, moved);
    updateLayers(nextLayers);
  };

  const focusLayerProperty = (layer: MotionLayer, property: MotionAnimatableProperty) => {
    selectLayer(layer.id);
    setSelectedProperty(property);
  };

  const toggleSummaryAnimation = (
    layer: MotionLayer,
    summary: SummaryProperty,
    localTime: number,
    animated: boolean,
  ) => {
    const nextLayer = animated
      ? summary.props.reduce(
          (acc, prop) => removeMotionLayerPropertyKeyframes(acc, prop),
          layer,
        )
      : summary.props.reduce(
          (acc, prop) =>
            upsertMotionLayerKeyframe(acc, prop, localTime, {
              value: getMotionLayerPropertyValueAtTime(
                acc,
                prop,
                localTime,
                composition,
              ),
            }),
          layer,
        );
    updateLayers(
      composition.layers.map((current) =>
        current.id === layer.id ? nextLayer : current,
      ),
    );
    setSelectedProperty(summary.props[0]);
  };

  const seekToKeyframe = (
    layer: MotionLayer,
    property: MotionAnimatableProperty,
    keyframeTime: number,
  ) => {
    selectLayer(layer.id);
    setSelectedProperty(property);
    setPlayhead(
      Math.min(composition.duration, Math.max(0, layer.startTime + keyframeTime)),
    );
  };

  const selectLayerRange = (clickedLayerId: string) => {
    const orderForRange = visibleLayers.length > 0 ? visibleLayers : orderedLayers;
    const anchorId = selectedLayerIds[selectedLayerIds.length - 1];
    const clickedIndex = orderForRange.findIndex((layer) => layer.id === clickedLayerId);
    if (clickedIndex < 0) return;
    const anchorIndex = anchorId
      ? orderForRange.findIndex((layer) => layer.id === anchorId)
      : -1;
    if (anchorIndex < 0) {
      setSelectedLayers([clickedLayerId]);
      return;
    }
    const start = Math.min(anchorIndex, clickedIndex);
    const end = Math.max(anchorIndex, clickedIndex);
    setSelectedLayers(orderForRange.slice(start, end + 1).map((layer) => layer.id));
  };

  const removeLayer = (layerId: string) => {
    const nextComposition = removeMotionLayers(composition, [layerId]);
    updateComposition(nextComposition);
    const remainingLayerIds = new Set(nextComposition.layers.map((layer) => layer.id));
    setSelectedLayers(selectedLayerIds.filter((id) => remainingLayerIds.has(id)));
  };

  const removeSelection = () => {
    if (selectedLayerIds.length === 0) return;
    updateComposition(removeMotionLayers(composition, selectedLayerIds));
    setSelectedLayers([]);
    setContextMenu(null);
  };

  const alignSelection = (alignment: MotionLayerAlignment) => {
    const relativeTo = selectedLayerIds.length > 1 ? "selection" : "composition";
    updateComposition(
      alignMotionLayers(composition, selectedLayerIds, alignment, { relativeTo }),
    );
  };

  const distributeSelection = (axis: MotionLayerDistributionAxis) => {
    updateComposition(distributeMotionLayers(composition, selectedLayerIds, axis));
  };

  const precomposeSelection = async () => {
    if (selectedLayerIds.length === 0) return;
    const selectedNames = composition.layers
      .filter((layer) => selectedLayerIds.includes(layer.id))
      .map((layer) => layer.name);
    const result = precomposeMotionLayers(composition, selectedLayerIds, {
      compositionId: makeId("motion"),
      layerId: makeId("motion-layer"),
      name:
        selectedNames.length === 1
          ? `${selectedNames[0]} Precomp`
          : "Precomp Selection",
    });
    if (!result) return;
    const nestedResult = await upsertMotionComposition(result.nestedComposition);
    if (!nestedResult.success) return;
    const hostResult = await upsertMotionComposition(result.hostComposition);
    if (hostResult.success) setSelectedLayers([result.precompLayerId]);
  };

  const createSelectionController = () => {
    if (selectedLayerIds.length === 0) return;
    const result = createMotionNullControllerForLayers(composition, selectedLayerIds, {
      id: makeId("motion-layer"),
      name:
        selectedLayerIds.length === 1 ? "Layer Controller" : "Selection Controller",
      guideColor: "#38bdf8",
    });
    if (!result) return;
    updateComposition(result.composition);
    setSelectedLayers([result.controllerLayerId]);
  };

  const groupSelection = () => {
    if (selectedLayerIds.length === 0) return;
    const result = groupMotionLayers(composition, selectedLayerIds, {
      id: makeId("motion-layer"),
      name: "Group",
    });
    if (!result) return;
    updateComposition(result.composition);
    setSelectedLayers([result.groupLayerId]);
  };

  const ungroupSelection = () => {
    const groupIds = composition.layers
      .filter(
        (layer) => layer.type === "group" && selectedLayerIds.includes(layer.id),
      )
      .map((layer) => layer.id);
    if (groupIds.length === 0) return;
    const childIds = composition.layers
      .filter((layer) => layer.parentId && groupIds.includes(layer.parentId))
      .map((layer) => layer.id);
    updateComposition(ungroupMotionLayers(composition, groupIds));
    setSelectedLayers(childIds);
  };

  const clearSelectionParents = () => {
    if (selectedLayerIds.length === 0) return;
    updateComposition(clearMotionLayerParents(composition, selectedLayerIds));
  };

  const disintegrateSelection = () => {
    if (selectedLayerIds.length === 0) return;
    const targetId = selectedLayerIds[selectedLayerIds.length - 1];
    const result = disintegrateMotionLayer(composition, targetId, {
      time: Math.max(0, playhead),
    });
    if (!result) return;
    updateComposition(result.composition);
    setSelectedLayers([result.particleLayerId]);
  };

  const morphSelection = () => {
    if (selectedLayerIds.length !== 2) return;
    const next = morphMotionLayers(
      composition,
      selectedLayerIds[0],
      selectedLayerIds[1],
      { time: Math.max(0, playhead) },
    );
    if (next) updateComposition(next);
  };

  const cursorClickSelection = () => {
    if (selectedLayerIds.length === 0) return;
    const targetId = selectedLayerIds[selectedLayerIds.length - 1];
    const result = createCursorClick(composition, targetId, {
      time: Math.max(0, playhead),
    });
    if (!result) return;
    updateComposition(result.composition);
    setSelectedLayers([result.cursorLayerId]);
  };

  const setLayerParent = (layerId: string, parentId: string) => {
    if (!parentId) {
      updateComposition(clearMotionLayerParents(composition, [layerId]));
      return;
    }
    updateComposition(
      parentMotionLayers(composition, [layerId], parentId, {
        preserveStagePosition: true,
      }),
    );
  };

  const orderedLayers = [...composition.layers].reverse();
  const layerById = new Map(composition.layers.map((layer) => [layer.id, layer]));
  const layerDepth = (layer: MotionLayer): number => {
    let depth = 0;
    let currentParentId = layer.parentId;
    const visited = new Set<string>();
    while (currentParentId && !visited.has(currentParentId) && depth < 4) {
      visited.add(currentParentId);
      depth += 1;
      currentParentId = layerById.get(currentParentId)?.parentId;
    }
    return depth;
  };
  const parentIds = new Set(
    composition.layers
      .map((layer) => layer.parentId)
      .filter((id): id is string => Boolean(id)),
  );
  const hasCollapsedAncestor = (layer: MotionLayer): boolean => {
    let currentParentId = layer.parentId;
    const visited = new Set<string>();
    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId);
      if (collapsed.has(currentParentId)) return true;
      currentParentId = layerById.get(currentParentId)?.parentId;
    }
    return false;
  };
  const selectedLayerIdSet = new Set(selectedLayerIds);
  const canAlign = selectedLayerIds.length > 0;
  const canDistribute = selectedLayerIds.length > 2;
  const hasParentedSelection = composition.layers.some(
    (layer) => selectedLayerIdSet.has(layer.id) && Boolean(layer.parentId),
  );

  const normalizedQuery = query.trim().toLowerCase();
  const editableLayers = composition.hideShyLayers
    ? orderedLayers.filter((layer) => !layer.shy)
    : orderedLayers;
  const visibleLayers = normalizedQuery
    ? editableLayers.filter((layer) =>
        layer.name.toLowerCase().includes(normalizedQuery),
      )
    : editableLayers.filter((layer) => !hasCollapsedAncestor(layer));

  const openPrecompLayer = (layer: MotionLayer) => {
    if (layer.type !== "composition") return;
    const source = motionCompositions.find(
      (candidate) => candidate.id === layer.compositionId,
    );
    if (source) openComposition(source.id, composition.id);
  };

  const toggleExpand = (layerId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  const toggleCollapse = (layerId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border pl-3.5 pr-2">
        <span className="text-[13px] font-semibold text-fg">Layers</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={VenetianMask}
            label={composition.hideShyLayers ? "Show shy layers" : "Hide shy layers"}
            size="sm"
            active={Boolean(composition.hideShyLayers)}
            onClick={() =>
              updateComposition({
                ...composition,
                hideShyLayers: !composition.hideShyLayers,
                modifiedAt: Date.now(),
              })
            }
          />
          <IconButton
            icon={Search}
            label="Search layers"
            size="sm"
            active={searchOpen}
            onClick={() => {
              setSearchOpen((value) => {
                if (value) setQuery("");
                return !value;
              });
            }}
          />
          <div className="relative">
            <IconButton
              icon={SlidersHorizontal}
              label="Layer tools"
              size="sm"
              active={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            />
            {menuOpen ? (
              <>
                <div
                  aria-hidden="true"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-lg border border-border bg-bg-elev p-1.5 shadow-lg">
                  <MenuLabel>Add layer</MenuLabel>
                  <AddMenuItem icon={Type} label="Text layer" onClick={addTextLayer} />
                  <AddMenuItem icon={Square} label="Shape layer" onClick={addShapeLayer} />
                  <AddMenuItem icon={Sparkles} label="Particle layer" onClick={addParticleLayer} />
                  <AddMenuItem
                    icon={SlidersHorizontal}
                    label="Adjustment layer"
                    onClick={addAdjustmentLayer}
                  />
                  <AddMenuItem
                    icon={Clapperboard}
                    label="Precomp layer"
                    onClick={() => void addPrecompLayer()}
                  />
                  <AddMenuItem icon={Layers} label="Group layer" onClick={addGroupLayer} />
                  <AddMenuItem icon={Crosshair} label="Null controller" onClick={addNullLayer} />
                  {selectedLayerIds.length > 0 ? (
                    <>
                      <div className="my-1 h-px bg-border" />
                      <MenuLabel>Selection</MenuLabel>
                      <AddMenuItem
                        icon={Layers}
                        label="Group selection"
                        onClick={() => {
                          groupSelection();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={Layers}
                        label="Ungroup"
                        disabled={
                          !composition.layers.some(
                            (layer) =>
                              layer.type === "group" &&
                              selectedLayerIds.includes(layer.id),
                          )
                        }
                        onClick={() => {
                          ungroupSelection();
                          setMenuOpen(false);
                        }}
                      />
                      {(() => {
                        const group = firstSelectedLayer(
                          (layer) => layer.type === "group",
                        );
                        if (!group || group.type !== "group") return null;
                        const auto = group.autoLayout;
                        return (
                          <>
                            <AddMenuItem
                              icon={StretchHorizontal}
                              label={
                                auto?.direction === "horizontal"
                                  ? "Auto-layout: Row ✓"
                                  : "Auto-layout: Row"
                              }
                              onClick={() => {
                                setSelectionAutoLayout({
                                  direction: "horizontal",
                                  gap: 24,
                                  align: "center",
                                });
                                setMenuOpen(false);
                              }}
                            />
                            <AddMenuItem
                              icon={StretchVertical}
                              label={
                                auto?.direction === "vertical"
                                  ? "Auto-layout: Column ✓"
                                  : "Auto-layout: Column"
                              }
                              onClick={() => {
                                setSelectionAutoLayout({
                                  direction: "vertical",
                                  gap: 24,
                                  align: "center",
                                });
                                setMenuOpen(false);
                              }}
                            />
                            {auto ? (
                              <AddMenuItem
                                icon={Unlock}
                                label="Auto-layout: Off"
                                onClick={() => {
                                  setSelectionAutoLayout(null);
                                  setMenuOpen(false);
                                }}
                              />
                            ) : null}
                          </>
                        );
                      })()}
                      <AddMenuItem
                        icon={Clapperboard}
                        label="Create component (precompose)"
                        onClick={() => {
                          void precomposeSelection();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={Copy}
                        label="Add instance"
                        disabled={
                          !composition.layers.some(
                            (layer) =>
                              layer.type === "composition" &&
                              selectedLayerIds.includes(layer.id),
                          )
                        }
                        onClick={() => {
                          addInstanceOfSelection();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={Crosshair}
                        label="Create controller"
                        onClick={() => {
                          createSelectionController();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={Sparkles}
                        label="Disintegrate"
                        onClick={() => {
                          disintegrateSelection();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={Shuffle}
                        label="Morph → next"
                        disabled={selectedLayerIds.length !== 2}
                        onClick={() => {
                          morphSelection();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={MousePointerClick}
                        label="Cursor click"
                        onClick={() => {
                          cursorClickSelection();
                          setMenuOpen(false);
                        }}
                      />
                      <AddMenuItem
                        icon={Unlock}
                        label="Clear parent"
                        disabled={!hasParentedSelection}
                        onClick={() => {
                          clearSelectionParents();
                          setMenuOpen(false);
                        }}
                      />
                      <div className="mt-1 grid grid-cols-8 gap-0.5 px-1.5 pb-1">
                        <IconButton icon={AlignHorizontalJustifyStart} label="Align left" size="sm" iconSize={13} disabled={!canAlign} onClick={() => alignSelection("left")} />
                        <IconButton icon={AlignHorizontalJustifyCenter} label="Align center" size="sm" iconSize={13} disabled={!canAlign} onClick={() => alignSelection("center-x")} />
                        <IconButton icon={AlignHorizontalJustifyEnd} label="Align right" size="sm" iconSize={13} disabled={!canAlign} onClick={() => alignSelection("right")} />
                        <IconButton icon={AlignHorizontalDistributeCenter} label="Distribute H" size="sm" iconSize={13} disabled={!canDistribute} onClick={() => distributeSelection("horizontal")} />
                        <IconButton icon={AlignVerticalJustifyStart} label="Align top" size="sm" iconSize={13} disabled={!canAlign} onClick={() => alignSelection("top")} />
                        <IconButton icon={AlignVerticalJustifyCenter} label="Align middle" size="sm" iconSize={13} disabled={!canAlign} onClick={() => alignSelection("center-y")} />
                        <IconButton icon={AlignVerticalJustifyEnd} label="Align bottom" size="sm" iconSize={13} disabled={!canAlign} onClick={() => alignSelection("bottom")} />
                        <IconButton icon={AlignVerticalDistributeCenter} label="Distribute V" size="sm" iconSize={13} disabled={!canDistribute} onClick={() => distributeSelection("vertical")} />
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {searchOpen ? (
        <div className="shrink-0 border-b border-border bg-bg-1 px-3 py-2">
          <ToolcraftTextInputControl
            ariaLabel="Filter layers"
            autoFocus
            clearable
            value={query}
            placeholder="Filter layers"
            leading={<Search size={13} aria-hidden />}
            onChange={setQuery}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {orderedLayers.length === 0 ? (
          <div className="px-3 pt-8">
            <EmptyState
              icon={Layers}
              title="No layers yet"
              description="Add text or shapes to start building your motion scene."
              action={
                <Button
                  label="Add layer"
                  icon={Plus}
                  variant="solid"
                  onClick={addTextLayer}
                />
              }
            />
          </div>
        ) : (
          <div className="min-w-[420px]">
            <div
              className="sticky top-0 z-10 grid h-7 items-center border-b border-border bg-bg-1 pl-1.5 text-[10px] font-medium tracking-[0.02em] text-fg-muted"
              style={{ gridTemplateColumns: LAYER_TABLE_COLUMNS }}
            >
              <div className="px-1 text-center">#</div>
              <div className="px-1.5">Layer Name</div>
              <div className="px-1">
                {timelineColumnMode === "modes" ? "Modes" : "Switches"}
              </div>
              <div className="px-1.5">Parent</div>
              <div className="px-1.5 text-right">In</div>
              <div className="px-1.5 text-right">Out</div>
            </div>

            {visibleLayers.length === 0 ? (
              <div className="px-4 py-6 text-center text-[12px] text-fg-muted">
                No layers match “{query}”.
              </div>
            ) : (
              <ul>
                {visibleLayers.map((layer) => {
                  const meta = LAYER_META[layer.type];
                  const Icon = meta.icon;
                  const selected = selectedLayerIdSet.has(layer.id);
                  const depth = layerDepth(layer);
                  const orderIndex = orderedLayers.indexOf(layer) + 1;
                  const layerEnd = layer.startTime + layer.duration;
                  const isExpanded = expanded.has(layer.id);
                  const hasChildren = parentIds.has(layer.id);
                  const isCollapsed = collapsed.has(layer.id);
                  const twirlOpen = hasChildren ? !isCollapsed : isExpanded;
                  const localTime = Math.min(
                    layer.duration,
                    Math.max(0, playhead - layer.startTime),
                  );
                  const summaries = SUMMARY_PROPERTIES.map((summary) => {
                    const animated = summary.props.some(
                      (prop) => getMotionLayerPropertyKeyframes(layer, prop).length > 0,
                    );
                    const values = summary.props.map((prop) =>
                      getMotionLayerPropertyValueAtTime(
                        layer,
                        prop,
                        localTime,
                        composition,
                      ),
                    );
                    return { ...summary, animated, value: summary.format(values) };
                  });
                  const animatedSummaries = summaries.filter((item) => item.animated);
                  const subRows = animatedSummaries.length > 0 ? animatedSummaries : summaries;
                  const parentOptions = composition.layers.filter((candidate) =>
                    canParentMotionLayer(composition, layer.id, candidate.id),
                  );

                  return (
                    <li key={layer.id} className="border-b border-border/70 last:border-b-0">
                      <div
                        draggable={renamingLayerId !== layer.id}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!selectedLayerIdSet.has(layer.id)) {
                            setSelectedLayers([layer.id]);
                          }
                          const menuWidth = 236;
                          const menuHeight = 480;
                          setContextMenu({
                            layerId: layer.id,
                            x: Math.max(
                              8,
                              Math.min(event.clientX, window.innerWidth - menuWidth - 8),
                            ),
                            y: Math.max(
                              8,
                              Math.min(event.clientY, window.innerHeight - menuHeight - 8),
                            ),
                          });
                        }}
                        onDragStart={(event) => {
                          setDraggingLayerId(layer.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(event) => {
                          if (draggingLayerId && draggingLayerId !== layer.id) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            if (dragOverLayerId !== layer.id) setDragOverLayerId(layer.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverLayerId === layer.id) setDragOverLayerId(null);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggingLayerId) reorderLayer(draggingLayerId, layer.id);
                          setDraggingLayerId(null);
                          setDragOverLayerId(null);
                        }}
                        onDragEnd={() => {
                          setDraggingLayerId(null);
                          setDragOverLayerId(null);
                        }}
                        className={`group relative grid min-h-[30px] items-stretch text-left transition-colors ${
                          selected ? "bg-selected" : "bg-bg-1 hover:bg-hover"
                        } ${layer.visible ? "" : "opacity-55"} ${
                          draggingLayerId === layer.id ? "opacity-40" : ""
                        } ${
                          dragOverLayerId === layer.id && draggingLayerId !== layer.id
                            ? "ring-1 ring-inset ring-accent"
                            : ""
                        }`}
                        style={{ gridTemplateColumns: LAYER_TABLE_COLUMNS }}
                      >
                        <span
                          className={`absolute inset-y-0 left-0 w-[3px] ${layer.labelColor ? "" : meta.rail}`}
                          style={layer.labelColor ? { backgroundColor: layer.labelColor } : undefined}
                        />
                        <div className="flex items-center justify-center pl-1.5 text-[10.5px] tabular-nums text-fg-muted">
                          {orderIndex}
                        </div>
                        <div className="relative flex min-w-0 items-center gap-1 px-1.5">
                          <IconButton
                            label={
                              hasChildren
                                ? twirlOpen
                                  ? "Collapse group"
                                  : "Expand group"
                                : isExpanded
                                  ? "Collapse layer"
                                  : "Expand layer"
                            }
                            icon={
                              <ChevronRight
                                size={12}
                                aria-hidden
                                className={`transition-transform ${twirlOpen ? "rotate-90" : ""}`}
                              />
                            }
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              hasChildren
                                ? toggleCollapse(layer.id)
                                : toggleExpand(layer.id)
                            }
                            className={`h-4 w-4 shrink-0 ${
                              hasChildren ? "text-fg-3" : "text-fg-muted"
                            }`}
                            style={{ marginLeft: `${depth * 12}px` }}
                          />
                          {renamingLayerId === layer.id ? (
                            <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5">
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                                  selected ? "text-accent" : meta.tint
                                }`}
                              >
                                <Icon size={14} aria-hidden />
                              </span>
                              <input
                                autoFocus
                                aria-label={`Rename ${layer.name}`}
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onBlur={commitRename}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    commitRename();
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    setRenamingLayerId(null);
                                    setRenameValue("");
                                  }
                                }}
                                className="h-6 min-w-0 flex-1 rounded-[4px] border border-accent bg-bg px-1.5 text-[12px] font-medium text-fg outline-none ring-2 ring-accent-soft"
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              aria-label={`Select ${layer.name}`}
                              aria-pressed={selected}
                              onClick={(event) => {
                                if (event.shiftKey) {
                                  selectLayerRange(layer.id);
                                  return;
                                }
                                if (event.metaKey || event.ctrlKey) {
                                  toggleLayerSelection(layer.id);
                                  return;
                                }
                                selectLayer(layer.id);
                              }}
                              onDoubleClick={(event) => {
                                event.stopPropagation();
                                beginRename(layer);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                            >
                              <span
                                className={`flex h-5 w-5 shrink-0 items-center justify-center ${
                                  selected ? "text-accent" : meta.tint
                                }`}
                              >
                                <Icon size={14} aria-hidden />
                              </span>
                              <span
                                className={`truncate text-[12px] leading-tight ${
                                  selected ? "font-semibold text-accent" : "font-medium text-fg"
                                }`}
                                title={layer.name}
                              >
                                {layer.name}
                              </span>
                            </button>
                          )}
                            <div
                            className={`pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-l-md pl-3 pr-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [&>button]:pointer-events-auto ${
                              selected
                                ? "bg-gradient-to-l from-selected via-selected"
                                : "bg-gradient-to-l from-bg-1 via-bg-1"
                            }`}
                          >
                            {layer.type === "composition" ? (
                              <LayerActionButton icon={ExternalLink} label="Open precomp" onClick={() => openPrecompLayer(layer)} />
                            ) : null}
                            <LayerActionButton icon={ArrowUp} label="Move forward" onClick={() => moveLayer(layer.id, 1)} />
                            <LayerActionButton icon={ArrowDown} label="Move backward" onClick={() => moveLayer(layer.id, -1)} />
                            <LayerActionButton icon={Copy} label="Duplicate layer" onClick={() => duplicateLayer(layer.id)} />
                            <LayerActionButton icon={Trash2} label="Delete layer" danger onClick={() => removeLayer(layer.id)} />
                          </div>
                        </div>
                        {timelineColumnMode === "modes" ? (
                          <div className="flex min-w-0 items-center px-1">
                            <BlendModeSelect
                              value={layer.blendMode ?? "normal"}
                              onChange={(blendMode) =>
                                patchLayer(layer.id, { blendMode } as Partial<MotionLayer>)
                              }
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-0.5 px-1">
                            <LayerSwitchButton
                              icon={layer.visible ? Eye : EyeOff}
                              label="Layer visibility"
                              active={layer.visible}
                              activeClassName="text-fg-2"
                              onClick={() =>
                                patchLayer(layer.id, { visible: !layer.visible } as Partial<MotionLayer>)
                              }
                            />
                            <LayerSwitchButton
                              icon={Star}
                              label="Solo layer"
                              active={Boolean(layer.solo)}
                              activeClassName="text-status-warning"
                              fillWhenActive
                              onClick={() => toggleLayerSolo(layer)}
                            />
                            <LayerSwitchButton
                              icon={layer.locked ? Lock : Unlock}
                              label="Lock layer"
                              active={Boolean(layer.locked)}
                              activeClassName="text-status-warning"
                              onClick={() =>
                                patchLayer(layer.id, { locked: !layer.locked } as Partial<MotionLayer>)
                              }
                            />
                            <LayerSwitchButton
                              icon={Ruler}
                              label="Guide layer"
                              active={Boolean(layer.guideLayer)}
                              activeClassName="text-accent"
                              onClick={() =>
                                patchLayer(layer.id, { guideLayer: !layer.guideLayer } as Partial<MotionLayer>)
                              }
                            />
                            <LayerSwitchButton
                              icon={VenetianMask}
                              label="Shy layer"
                              active={Boolean(layer.shy)}
                              activeClassName="text-accent"
                              onClick={() =>
                                patchLayer(layer.id, { shy: !layer.shy } as Partial<MotionLayer>)
                              }
                            />
                          </div>
                        )}
                        <div className="flex min-w-0 items-center px-1">
                          <ParentSelect
                            value={layer.parentId ?? ""}
                            options={parentOptions}
                            onChange={(parentId) => setLayerParent(layer.id, parentId)}
                          />
                        </div>
                        <div className="flex items-center justify-end px-1.5 font-mono text-[10.5px] tabular-nums text-fg-3">
                          {formatMotionTimecode(layer.startTime, composition.frameRate)}
                        </div>
                        <div className="flex items-center justify-end px-1.5 font-mono text-[10.5px] tabular-nums text-fg-3">
                          {formatMotionTimecode(layerEnd, composition.frameRate)}
                        </div>
                      </div>

                      {isExpanded
                        ? subRows.map((summary) => {
                            const summaryKeyframes = summary.props
                              .flatMap((prop) =>
                                getMotionLayerPropertyKeyframes(layer, prop),
                              )
                              .sort((a, b) => a.time - b.time);
                            const firstKeyframe = summaryKeyframes[0];
                            const lastKeyframe =
                              summaryKeyframes[summaryKeyframes.length - 1];
                            return (
                              <div
                                key={summary.key}
                                className="grid min-h-[26px] items-center bg-bg/40 text-left"
                                style={{ gridTemplateColumns: LAYER_TABLE_COLUMNS }}
                              >
                                <div />
                                <div
                                  className="flex min-w-0 items-center gap-1.5 px-1.5"
                                  style={{ paddingLeft: `${depth * 12 + 26}px` }}
                                >
                                  <IconButton
                                    label={
                                      summary.animated
                                        ? `Disable ${summary.label} animation`
                                        : `Animate ${summary.label}`
                                    }
                                    icon={
                                      <Clock
                                        size={11}
                                        aria-hidden
                                        className={summary.animated ? "text-accent" : "text-fg-muted"}
                                        fill={summary.animated ? "currentColor" : "none"}
                                      />
                                    }
                                    size="sm"
                                    variant="ghost"
                                    aria-pressed={summary.animated}
                                    onClick={() =>
                                      toggleSummaryAnimation(
                                        layer,
                                        summary,
                                        localTime,
                                        summary.animated,
                                      )
                                    }
                                    className="h-4 w-4 shrink-0 rounded-[3px]"
                                  />
                                  <Button
                                    label={summary.label}
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => focusLayerProperty(layer, summary.props[0])}
                                    className="h-auto min-h-0 justify-start truncate rounded-[3px] px-0 py-0 text-left text-[11px] text-fg-3 transition-colors hover:text-fg"
                                  >
                                    {summary.label}
                                  </Button>
                                </div>
                                <div className="px-1 text-[11px] tabular-nums text-accent">
                                  <span className="truncate">{summary.value}</span>
                                </div>
                                <div />
                                <div className="flex items-center justify-end px-1.5">
                                  {summary.animated && firstKeyframe ? (
                                    <KeyDiamondButton
                                      label={`${summary.label} keyframe`}
                                      onClick={() =>
                                        seekToKeyframe(layer, summary.props[0], firstKeyframe.time)
                                      }
                                    />
                                  ) : null}
                                </div>
                                <div className="flex items-center justify-end px-1.5">
                                  {summary.animated && lastKeyframe ? (
                                    <KeyDiamondButton
                                      label={`${summary.label} keyframe`}
                                      onClick={() =>
                                        seekToKeyframe(layer, summary.props[0], lastKeyframe.time)
                                      }
                                    />
                                  ) : null}
                                </div>
                              </div>
                            );
                          })
                        : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {contextMenu ? (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-[70]"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            role="menu"
            aria-label="Layer actions"
            className="fixed z-[71] w-[236px] overflow-hidden rounded-lg border border-border bg-bg-elev p-1.5 shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <MenuLabel>
              {selectedLayerIds.length > 1
                ? `${selectedLayerIds.length} layers selected`
                : (composition.layers.find((layer) => layer.id === contextMenu.layerId)
                    ?.name ?? "Layer")}
            </MenuLabel>
            <AddMenuItem
              icon={Pencil}
              label="Rename layer"
              disabled={selectedLayerIds.length !== 1}
              onClick={() => {
                const layer = composition.layers.find(
                  (candidate) => candidate.id === contextMenu.layerId,
                );
                if (layer) beginRename(layer);
              }}
            />
            <AddMenuItem
              icon={Copy}
              label="Duplicate selection"
              onClick={() => {
                duplicateSelection();
                setContextMenu(null);
              }}
            />
            <AddMenuItem
              icon={ArrowUp}
              label="Move layer forward"
              disabled={selectedLayerIds.length !== 1}
              onClick={() => {
                moveLayer(contextMenu.layerId, 1);
                setContextMenu(null);
              }}
            />
            <AddMenuItem
              icon={ArrowDown}
              label="Move layer backward"
              disabled={selectedLayerIds.length !== 1}
              onClick={() => {
                moveLayer(contextMenu.layerId, -1);
                setContextMenu(null);
              }}
            />
            <div className="my-1 h-px bg-border" />
            <MenuLabel>Label color</MenuLabel>
            <div className="grid grid-cols-7 gap-1 px-2 pb-1.5" role="group" aria-label="Layer label color">
              <button
                type="button"
                aria-label="Clear layer label color"
                title="None"
                onClick={() => setSelectionLabelColor(undefined)}
                className="relative h-5 w-5 rounded-full border border-border bg-bg-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="absolute left-[3px] top-1/2 h-px w-3 -rotate-45 bg-status-error" />
              </button>
              {MOTION_LAYER_LABEL_COLORS.map((label) => (
                <button
                  key={label.name}
                  type="button"
                  aria-label={`Set layer label ${label.name}`}
                  title={label.name}
                  onClick={() => setSelectionLabelColor(label.color)}
                  className="h-5 w-5 rounded-full border border-white/20 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  style={{ backgroundColor: label.color }}
                />
              ))}
            </div>
            <div className="my-1 h-px bg-border" />
            <AddMenuItem
              icon={Layers}
              label="Group selection"
              onClick={() => {
                groupSelection();
                setContextMenu(null);
              }}
            />
            <AddMenuItem
              icon={Layers}
              label="Ungroup selection"
              disabled={!composition.layers.some(
                (layer) =>
                  layer.type === "group" && selectedLayerIds.includes(layer.id),
              )}
              onClick={() => {
                ungroupSelection();
                setContextMenu(null);
              }}
            />
            <AddMenuItem
              icon={Clapperboard}
              label="Precompose selection"
              onClick={() => {
                void precomposeSelection();
                setContextMenu(null);
              }}
            />
            <AddMenuItem
              icon={Crosshair}
              label="Create controller"
              onClick={() => {
                createSelectionController();
                setContextMenu(null);
              }}
            />
            <AddMenuItem
              icon={Unlock}
              label="Clear parent"
              disabled={!hasParentedSelection}
              onClick={() => {
                clearSelectionParents();
                setContextMenu(null);
              }}
            />
            <div className="my-1 h-px bg-border" />
            <AddMenuItem
              icon={Trash2}
              label="Delete selection"
              onClick={removeSelection}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function KeyDiamondButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={<span aria-hidden className="block h-2 w-2 rotate-45 rounded-[1px] bg-accent" />}
      size="sm"
      variant="ghost"
      onClick={onClick}
      className="h-3 w-3"
    />
  );
}

function BlendModeSelect({
  value,
  onChange,
}: {
  value: BlendMode;
  onChange: (value: BlendMode) => void;
}): JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      <SelectInput
        value={value}
        options={MOTION_BLEND_MODE_OPTIONS.map((mode) => ({
          value: mode.id,
          label: mode.name,
        }))}
        onChange={(nextValue) => onChange(nextValue as BlendMode)}
      />
    </div>
  );
}

function ParentSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: MotionLayer[];
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      <SelectInput
        value={value}
        disabled={options.length === 0}
        options={[
          { value: "", label: "-" },
          ...options.map((option) => ({
            value: option.id,
            label: option.name,
          })),
        ]}
        onChange={onChange}
      />
    </div>
  );
}

function MenuLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
      {children}
    </div>
  );
}

function LayerActionButton({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={<Icon size={12} aria-hidden />}
      size="sm"
      variant={danger ? "destructive" : "ghost"}
      onClick={onClick}
      className={`h-6 w-6 rounded-[4px] ${
        danger
          ? "text-fg-muted hover:bg-status-error/15 hover:text-status-error"
          : "text-fg-muted hover:bg-hover hover:text-fg"
      }`}
    />
  );
}

function LayerSwitchButton({
  icon: Icon,
  label,
  active,
  activeClassName,
  fillWhenActive = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  activeClassName: string;
  fillWhenActive?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <IconButton
      label={label}
      icon={
        <Icon
          size={11}
          aria-hidden
          fill={fillWhenActive && active ? "currentColor" : "none"}
        />
      }
      size="sm"
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
      className={`h-5 w-5 rounded-[3px] hover:bg-hover hover:text-fg ${
        active ? activeClassName : "text-fg-muted/70"
      }`}
    />
  );
}

function AddMenuItem({
  icon: Icon,
  label,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      label={label}
      variant="ghost"
      size="sm"
      icon={<Icon size={14} className="text-fg-3" aria-hidden />}
      isDisabled={disabled}
      onClick={onClick}
      className="flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40"
    />
  );
}
