import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  MoveDown,
  MoveUp,
  Plus,
  Shapes,
  Trash2,
} from "lucide-react";
import {
  MOTION_SHAPE_MODIFIER_TYPES,
  addShapeItem,
  createMotionShapeModifier,
  createShapeGroupItem,
  createShapePathItem,
  findShapeItem,
  hasExplicitShapeContents,
  materializeShapeContents,
  moveShapeItem,
  removeShapeItem,
  updateShapeItem,
  type MotionComposition,
  type MotionShapeGroupItem,
  type MotionShapeGroupTransform,
  type MotionShapeItem,
  type MotionShapeLayer,
  type MotionShapeMergeMode,
  type MotionShapeModifier,
  type MotionShapeModifierType,
  type MotionShapePathItem,
  type ShapeStyle,
  type ShapeType,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { ColorInput, Field, NumberInput, Section } from "./primitives";
import { useTranslation } from "react-i18next";

const MERGE_MODE_OPTIONS: ReadonlyArray<{
  value: MotionShapeMergeMode;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "union", label: "Union" },
  { value: "subtract", label: "Subtract" },
  { value: "intersect", label: "Intersect" },
  { value: "exclude", label: "Exclude" },
];

const PATH_SHAPE_TYPES: readonly ShapeType[] = [
  "rectangle",
  "circle",
  "ellipse",
  "triangle",
  "arrow",
  "line",
  "polygon",
  "star",
  "path",
];

const OPERATOR_LABELS: Record<MotionShapeModifierType, string> = {
  "trim-paths": "Trim Paths",
  repeater: "Repeater",
  "zig-zag": "Zig Zag",
  "round-corners": "Round Corners",
  "wiggle-paths": "Wiggle Paths",
  "offset-paths": "Offset Paths",
  "pucker-bloat": "Pucker & Bloat",
  twist: "Twist",
};

const RESERVED_OPERATOR_KEYS: readonly string[] = ["id", "type", "name", "enabled"];

interface ShapeItemRow {
  readonly item: MotionShapeItem;
  readonly depth: number;
  readonly parentId: string | null;
}

function flattenRows(
  contents: readonly MotionShapeItem[],
  expanded: ReadonlySet<string>,
  depth: number,
  parentId: string | null,
): ShapeItemRow[] {
  const rows: ShapeItemRow[] = [];
  for (const item of contents) {
    rows.push({ item, depth, parentId });
    if (item.kind === "group" && expanded.has(item.id)) {
      rows.push(...flattenRows(item.items, expanded, depth + 1, item.id));
    }
  }
  return rows;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isFiniteNumericOperatorParam(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function ShapeContentsSection({
  composition,
  layer,
}: {
  composition: MotionComposition;
  layer: MotionShapeLayer;
}): JSX.Element {
  const { t } = useTranslation();
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const updateMotionCompositionPreview = useProjectStore(
    (state) => state.updateMotionCompositionPreview,
  );
  const commitMotionCompositionGesture = useProjectStore(
    (state) => state.commitMotionCompositionGesture,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [pendingOperator, setPendingOperator] =
    useState<MotionShapeModifierType>("offset-paths");

  const explicit = hasExplicitShapeContents(layer);
  const contents = layer.contents ?? [];

  const rows = useMemo(
    () => flattenRows(contents, expanded, 0, null),
    [contents, expanded],
  );

  const selectedItem = selectedItemId
    ? findShapeItem(contents, selectedItemId)
    : null;

  const compositionWithLayer = useCallback(
    (nextLayer: MotionShapeLayer): MotionComposition => ({
      ...composition,
      layers: composition.layers.map((candidate) =>
        candidate.id === nextLayer.id ? nextLayer : candidate,
      ),
      modifiedAt: Date.now(),
    }),
    [composition],
  );

  const gestureStartRef = useRef<MotionComposition | null>(null);
  const gesturePendingRef = useRef<MotionComposition | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushGesture = useCallback((): void => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const gestureStart = gestureStartRef.current;
    const pending = gesturePendingRef.current;
    gestureStartRef.current = null;
    gesturePendingRef.current = null;
    if (!gestureStart || !pending) return;
    void commitMotionCompositionGesture(gestureStart, pending);
  }, [commitMotionCompositionGesture]);

  const pendingLayer = (): MotionShapeLayer | null => {
    const pending = gesturePendingRef.current;
    if (!pending) return null;
    const candidate = pending.layers.find(
      (entry) => entry.id === layer.id,
    );
    return candidate && candidate.type === "shape" ? candidate : null;
  };

  const replaceLayer = (
    update: MotionShapeLayer | ((base: MotionShapeLayer) => MotionShapeLayer),
  ): void => {
    const base = pendingLayer() ?? layer;
    flushGesture();
    const nextLayer =
      typeof update === "function" ? update(base) : update;
    void upsertMotionComposition(compositionWithLayer(nextLayer));
  };

  const previewLayer = (nextLayer: MotionShapeLayer): void => {
    if (gestureStartRef.current === null) {
      gestureStartRef.current = composition;
    }
    const nextComposition = compositionWithLayer(nextLayer);
    gesturePendingRef.current = nextComposition;
    updateMotionCompositionPreview(nextComposition);
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      flushGesture();
    }, 320);
  };

  useEffect(() => {
    const flush = (): void => flushGesture();
    window.addEventListener("pointerup", flush);
    window.addEventListener("pointercancel", flush);
    return () => {
      window.removeEventListener("pointerup", flush);
      window.removeEventListener("pointercancel", flush);
      flushGesture();
    };
  }, [flushGesture]);

  const toggleExpanded = (id: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleMaterialize = (): void => {
    replaceLayer((base) => materializeShapeContents(base));
  };

  const targetGroupId = (): string | null => {
    if (!selectedItem) return null;
    return selectedItem.kind === "group" ? selectedItem.id : null;
  };

  const handleAddGroup = (): void => {
    const parentId = targetGroupId();
    const group = createShapeGroupItem("Group");
    replaceLayer((base) => addShapeItem(base, parentId, group));
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
    }
    setSelectedItemId(group.id);
  };

  const handleAddShape = (): void => {
    const parentId = targetGroupId();
    const item = createShapePathItem({ name: "Shape" });
    replaceLayer((base) => addShapeItem(base, parentId, item));
    if (parentId) {
      setExpanded((current) => new Set(current).add(parentId));
    }
    setSelectedItemId(item.id);
  };

  const handleMove = (id: string, direction: "up" | "down"): void => {
    replaceLayer((base) => moveShapeItem(base, id, direction));
  };

  const handleRemove = (id: string): void => {
    replaceLayer((base) => removeShapeItem(base, id));
    if (selectedItemId === id) {
      setSelectedItemId(null);
    }
  };

  const handleToggleVisibility = (item: MotionShapeItem): void => {
    const nextVisible = item.visible === false;
    replaceLayer((base) =>
      updateShapeItem(base, item.id, { visible: nextVisible }),
    );
  };

  const commitRename = (id: string): void => {
    const trimmed = renameDraft.trim();
    if (trimmed.length > 0) {
      replaceLayer((base) => updateShapeItem(base, id, { name: trimmed }));
    }
    setRenamingId(null);
  };

  const startRename = (item: MotionShapeItem): void => {
    setRenamingId(item.id);
    setRenameDraft(item.name);
  };

  const patchGroupTransform = (
    group: MotionShapeGroupItem,
    updater: (transform: MotionShapeGroupTransform) => MotionShapeGroupTransform,
  ): void => {
    previewLayer(
      updateShapeItem(layer, group.id, {
        transform: updater(group.transform),
      }),
    );
  };

  const resolveGroupOperators = (
    base: MotionShapeLayer,
    groupId: string,
  ): readonly MotionShapeModifier[] => {
    const resolved = findShapeItem(base.contents ?? [], groupId);
    return resolved && resolved.kind === "group"
      ? resolved.operators ?? []
      : [];
  };

  const setMergeMode = (group: MotionShapeGroupItem, mode: MotionShapeMergeMode): void => {
    replaceLayer((base) => updateShapeItem(base, group.id, { mergeMode: mode }));
  };

  const addOperator = (group: MotionShapeGroupItem): void => {
    const operator = createMotionShapeModifier(pendingOperator);
    replaceLayer((base) =>
      updateShapeItem(base, group.id, {
        operators: [...resolveGroupOperators(base, group.id), operator],
      }),
    );
  };

  const withUpdatedOperator = (
    base: MotionShapeLayer,
    groupId: string,
    operatorId: string,
    updater: (operator: MotionShapeModifier) => MotionShapeModifier,
  ): MotionShapeLayer => {
    const operators = resolveGroupOperators(base, groupId).map((operator) =>
      operator.id === operatorId ? updater(operator) : operator,
    );
    return updateShapeItem(base, groupId, { operators });
  };

  const updateOperator = (
    group: MotionShapeGroupItem,
    operatorId: string,
    updater: (operator: MotionShapeModifier) => MotionShapeModifier,
  ): void => {
    replaceLayer((base) =>
      withUpdatedOperator(base, group.id, operatorId, updater),
    );
  };

  const previewOperatorParam = (
    group: MotionShapeGroupItem,
    operatorId: string,
    updater: (operator: MotionShapeModifier) => MotionShapeModifier,
  ): void => {
    previewLayer(withUpdatedOperator(layer, group.id, operatorId, updater));
  };

  const removeOperator = (group: MotionShapeGroupItem, operatorId: string): void => {
    replaceLayer((base) =>
      updateShapeItem(base, group.id, {
        operators: resolveGroupOperators(base, group.id).filter(
          (operator) => operator.id !== operatorId,
        ),
      }),
    );
  };

  const moveOperator = (
    group: MotionShapeGroupItem,
    operatorId: string,
    direction: "up" | "down",
  ): void => {
    replaceLayer((base) => {
      const operators = [...resolveGroupOperators(base, group.id)];
      const index = operators.findIndex((operator) => operator.id === operatorId);
      if (index === -1) return base;
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith < 0 || swapWith >= operators.length) return base;
      const moved = operators[swapWith];
      const target = operators[index];
      if (!moved || !target) return base;
      operators[swapWith] = target;
      operators[index] = moved;
      return updateShapeItem(base, group.id, { operators });
    });
  };

  const patchPathItem = (
    item: MotionShapePathItem,
    patch: Partial<Omit<MotionShapePathItem, "kind" | "id">>,
  ): void => {
    replaceLayer((base) => updateShapeItem(base, item.id, patch));
  };

  const previewPathItem = (
    item: MotionShapePathItem,
    patch: Partial<Omit<MotionShapePathItem, "kind" | "id">>,
  ): void => {
    previewLayer(updateShapeItem(layer, item.id, patch));
  };

  if (!explicit) {
    return (
      <Section title={t("Contents")} icon={Shapes}>
        <div className="rounded-lg border border-border bg-bg-1 p-3">
          <p className="mb-2.5 text-[12px] text-fg-3">
            {t("Convert this shape into a contents tree to build groups, merge paths, and stack per-group operators.")}</p>
          <button
            type="button"
            onClick={handleMaterialize}
            className="w-full rounded-[7px] border border-border bg-bg-2 px-3 py-2 text-[13px] font-medium text-fg-2 transition-colors hover:border-accent"
          >
            {t("Group contents")}</button>
        </div>
      </Section>
    );
  }

  return (
    <Section title={t("Contents")} icon={Shapes}>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={handleAddGroup}
          className="rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[12px] font-medium text-fg-2 transition-colors hover:border-accent"
        >
          {t("Add group")}</button>
        <button
          type="button"
          onClick={handleAddShape}
          className="rounded-[7px] border border-border bg-bg-1 px-2.5 py-1.5 text-[12px] font-medium text-fg-2 transition-colors hover:border-accent"
        >
          {t("Add shape")}</button>
        <button
          type="button"
          disabled={!selectedItemId}
          onClick={() => selectedItemId && handleMove(selectedItemId, "up")}
          aria-label={t("Move up")}
          className="rounded-[7px] border border-border bg-bg-1 p-1.5 text-fg-2 transition-colors hover:border-accent disabled:opacity-40"
        >
          <MoveUp size={14} aria-hidden />
        </button>
        <button
          type="button"
          disabled={!selectedItemId}
          onClick={() => selectedItemId && handleMove(selectedItemId, "down")}
          aria-label={t("Move down")}
          className="rounded-[7px] border border-border bg-bg-1 p-1.5 text-fg-2 transition-colors hover:border-accent disabled:opacity-40"
        >
          <MoveDown size={14} aria-hidden />
        </button>
        <button
          type="button"
          disabled={!selectedItemId}
          onClick={() => selectedItemId && handleRemove(selectedItemId)}
          aria-label={t("Delete")}
          className="rounded-[7px] border border-border bg-bg-1 p-1.5 text-fg-2 transition-colors hover:border-danger disabled:opacity-40"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>

      <div className="space-y-0.5" data-testid="shape-contents-tree">
        {rows.map(({ item, depth }) => {
          const isGroup = item.kind === "group";
          const isSelected = item.id === selectedItemId;
          const isExpanded = expanded.has(item.id);
          const isHidden = item.visible === false;
          return (
            <div
              key={item.id}
              className={`flex items-center gap-1 rounded-[6px] py-1 pr-1.5 ${
                isSelected ? "bg-accent/12" : "hover:bg-bg-1"
              }`}
              style={{ paddingLeft: 4 + depth * 12 }}
            >
              {isGroup ? (
                <button
                  type="button"
                  aria-label={isExpanded ? t("Collapse group") : t("Expand group")}
                  onClick={() => toggleExpanded(item.id)}
                  className="shrink-0 text-fg-muted"
                >
                  <ChevronRight
                    size={12}
                    aria-hidden
                    className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <span className="w-3 shrink-0" aria-hidden />
              )}
              {isGroup ? (
                <Folder size={12} aria-hidden className="shrink-0 text-fg-muted" />
              ) : (
                <Shapes size={12} aria-hidden className="shrink-0 text-fg-muted" />
              )}
              {renamingId === item.id ? (
                <input
                  aria-label={t("Rename item")}
                  autoFocus
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => commitRename(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitRename(item.id);
                    } else if (event.key === "Escape") {
                      setRenamingId(null);
                    }
                  }}
                  className="min-w-0 flex-1 rounded-[5px] border border-accent bg-bg-1 px-1.5 py-0.5 text-[12px] text-fg-2 outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  onDoubleClick={() => startRename(item)}
                  className={`min-w-0 flex-1 truncate text-left text-[12px] font-medium ${
                    isHidden ? "text-fg-muted line-through" : "text-fg-2"
                  }`}
                >
                  {item.name}
                </button>
              )}
              <button
                type="button"
                aria-label={t("Toggle visibility")}
                onClick={() => handleToggleVisibility(item)}
                className="shrink-0 text-fg-muted transition-colors hover:text-fg-2"
              >
                {isHidden ? (
                  <EyeOff size={13} aria-hidden />
                ) : (
                  <Eye size={13} aria-hidden />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {selectedItem ? (
        <div
          className="space-y-3 rounded-lg border border-border bg-bg-1 p-3"
          data-testid="shape-contents-detail"
        >
          {selectedItem.kind === "group" ? (
            <GroupDetail
              group={selectedItem}
              pendingOperator={pendingOperator}
              onPendingOperatorChange={setPendingOperator}
              onTransform={patchGroupTransform}
              onMergeMode={setMergeMode}
              onAddOperator={addOperator}
              onUpdateOperator={updateOperator}
              onUpdateOperatorParam={previewOperatorParam}
              onRemoveOperator={removeOperator}
              onMoveOperator={moveOperator}
            />
          ) : (
            <PathDetail
              item={selectedItem}
              onPatch={patchPathItem}
              onPatchNumber={previewPathItem}
            />
          )}
        </div>
      ) : null}
    </Section>
  );
}

function GroupDetail({
  group,
  pendingOperator,
  onPendingOperatorChange,
  onTransform,
  onMergeMode,
  onAddOperator,
  onUpdateOperator,
  onUpdateOperatorParam,
  onRemoveOperator,
  onMoveOperator,
}: {
  group: MotionShapeGroupItem;
  pendingOperator: MotionShapeModifierType;
  onPendingOperatorChange: (type: MotionShapeModifierType) => void;
  onTransform: (
    group: MotionShapeGroupItem,
    updater: (transform: MotionShapeGroupTransform) => MotionShapeGroupTransform,
  ) => void;
  onMergeMode: (group: MotionShapeGroupItem, mode: MotionShapeMergeMode) => void;
  onAddOperator: (group: MotionShapeGroupItem) => void;
  onUpdateOperator: (
    group: MotionShapeGroupItem,
    operatorId: string,
    updater: (operator: MotionShapeModifier) => MotionShapeModifier,
  ) => void;
  onUpdateOperatorParam: (
    group: MotionShapeGroupItem,
    operatorId: string,
    updater: (operator: MotionShapeModifier) => MotionShapeModifier,
  ) => void;
  onRemoveOperator: (group: MotionShapeGroupItem, operatorId: string) => void;
  onMoveOperator: (
    group: MotionShapeGroupItem,
    operatorId: string,
    direction: "up" | "down",
  ) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const { transform } = group;
  const operators = group.operators ?? [];
  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("Position X")}>
          <NumberInput
            value={transform.position.x}
            onChange={(x) =>
              onTransform(group, (current) => ({
                ...current,
                position: { ...current.position, x },
              }))
            }
          />
        </Field>
        <Field label={t("Position Y")}>
          <NumberInput
            value={transform.position.y}
            onChange={(y) =>
              onTransform(group, (current) => ({
                ...current,
                position: { ...current.position, y },
              }))
            }
          />
        </Field>
        <Field label={t("Scale X")}>
          <NumberInput
            value={transform.scale.x}
            step={0.05}
            onChange={(x) =>
              onTransform(group, (current) => ({
                ...current,
                scale: { ...current.scale, x },
              }))
            }
          />
        </Field>
        <Field label={t("Scale Y")}>
          <NumberInput
            value={transform.scale.y}
            step={0.05}
            onChange={(y) =>
              onTransform(group, (current) => ({
                ...current,
                scale: { ...current.scale, y },
              }))
            }
          />
        </Field>
        <Field label={t("Rotation")}>
          <NumberInput
            value={transform.rotation}
            unit="deg"
            onChange={(rotation) =>
              onTransform(group, (current) => ({ ...current, rotation }))
            }
          />
        </Field>
        <Field label={t("Opacity")}>
          <NumberInput
            value={transform.opacity}
            min={0}
            max={1}
            step={0.05}
            onChange={(opacity) =>
              onTransform(group, (current) => ({ ...current, opacity }))
            }
          />
        </Field>
      </div>

      <Field label={t("Merge mode")}>
        <select
          aria-label={t("Merge mode")}
          value={group.mergeMode ?? "none"}
          onChange={(event) =>
            onMergeMode(group, event.target.value as MotionShapeMergeMode)
          }
          className="w-full cursor-pointer rounded-[7px] border border-border bg-bg-1 px-2.5 py-2 text-[13px] font-medium text-fg-2 outline-none"
        >
          {MERGE_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </Field>

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <select
            aria-label={t("Add operator")}
            value={pendingOperator}
            onChange={(event) =>
              onPendingOperatorChange(
                event.target.value as MotionShapeModifierType,
              )
            }
            className="min-w-0 flex-1 cursor-pointer rounded-[7px] border border-border bg-bg-1 px-2.5 py-2 text-[13px] font-medium text-fg-2 outline-none"
          >
            {MOTION_SHAPE_MODIFIER_TYPES.map((type) => (
              <option key={type} value={type}>
                {OPERATOR_LABELS[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t("Add operator to group")}
            onClick={() => onAddOperator(group)}
            className="flex shrink-0 items-center gap-1 rounded-[7px] border border-border bg-bg-2 px-2.5 py-2 text-[12px] font-medium text-fg-2 transition-colors hover:border-accent"
          >
            <Plus size={13} aria-hidden />
            {t("Add")}</button>
        </div>

        {operators.map((operator, index) => (
          <OperatorRow
            key={operator.id}
            operator={operator}
            isFirst={index === 0}
            isLast={index === operators.length - 1}
            onToggle={(enabled) =>
              onUpdateOperator(group, operator.id, (current) => ({
                ...current,
                enabled,
              }))
            }
            onParam={(param, value) =>
              onUpdateOperatorParam(group, operator.id, (current) => ({
                ...current,
                [param]: value,
              }))
            }
            onMoveUp={() => onMoveOperator(group, operator.id, "up")}
            onMoveDown={() => onMoveOperator(group, operator.id, "down")}
            onRemove={() => onRemoveOperator(group, operator.id)}
          />
        ))}
      </div>
    </>
  );
}

function OperatorRow({
  operator,
  isFirst,
  isLast,
  onToggle,
  onParam,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  operator: MotionShapeModifier;
  isFirst: boolean;
  isLast: boolean;
  onToggle: (enabled: boolean) => void;
  onParam: (param: string, value: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const numericParams = Object.entries(operator).filter(
    ([key, value]) =>
      !RESERVED_OPERATOR_KEYS.includes(key) &&
      isFiniteNumericOperatorParam(value),
  );
  return (
    <div className="space-y-2 rounded-[7px] border border-border bg-bg-2 p-2.5">
      <div className="flex items-center gap-1.5">
        <input
          type="checkbox"
          aria-label={`${OPERATOR_LABELS[operator.type]} enabled`}
          checked={operator.enabled}
          onChange={(event) => onToggle(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg-2">
          {OPERATOR_LABELS[operator.type]}
        </span>
        <button
          type="button"
          aria-label={t("Move operator up")}
          disabled={isFirst}
          onClick={onMoveUp}
          className="text-fg-muted transition-colors hover:text-fg-2 disabled:opacity-40"
        >
          <MoveUp size={12} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("Move operator down")}
          disabled={isLast}
          onClick={onMoveDown}
          className="text-fg-muted transition-colors hover:text-fg-2 disabled:opacity-40"
        >
          <MoveDown size={12} aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("Remove operator")}
          onClick={onRemove}
          className="text-fg-muted transition-colors hover:text-danger"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      {numericParams.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {numericParams.map(([key, value]) => (
            <Field key={key} label={capitalize(key)}>
              <NumberInput
                value={value}
                onChange={(next) => onParam(key, next)}
              />
            </Field>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PathDetail({
  item,
  onPatch,
  onPatchNumber,
}: {
  item: MotionShapePathItem;
  onPatch: (
    item: MotionShapePathItem,
    patch: Partial<Omit<MotionShapePathItem, "kind" | "id">>,
  ) => void;
  onPatchNumber: (
    item: MotionShapePathItem,
    patch: Partial<Omit<MotionShapePathItem, "kind" | "id">>,
  ) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const inherits = item.style === undefined;
  const style = item.style;
  const fillColor =
    style && style.fill.type === "solid" ? (style.fill.color ?? "#ffffff") : "#ffffff";
  const strokeColor = style ? style.stroke.color : "#ffffff";

  const setInherit = (nextInherit: boolean): void => {
    if (nextInherit) {
      onPatch(item, { style: undefined });
      return;
    }
    const nextStyle: ShapeStyle = {
      fill: { type: "solid", color: "#ffffff", opacity: 1 },
      stroke: { color: "#ffffff", width: 8, opacity: 1 },
    };
    onPatch(item, { style: nextStyle });
  };

  const patchStyle = (updater: (current: ShapeStyle) => ShapeStyle): void => {
    if (!style) return;
    onPatch(item, { style: updater(style) });
  };

  return (
    <>
      <Field label={t("Shape type")}>
        <select
          aria-label={t("Shape type")}
          value={item.shapeType}
          onChange={(event) =>
            onPatch(item, { shapeType: event.target.value as ShapeType })
          }
          className="w-full cursor-pointer rounded-[7px] border border-border bg-bg-1 px-2.5 py-2 text-[13px] font-medium text-fg-2 outline-none"
        >
          {PATH_SHAPE_TYPES.map((type) => (
            <option key={type} value={type}>
              {capitalize(type)}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("Width")}>
          <NumberInput
            value={item.width}
            min={1}
            unit="px"
            onChange={(width) => onPatchNumber(item, { width })}
          />
        </Field>
        <Field label={t("Height")}>
          <NumberInput
            value={item.height}
            min={1}
            unit="px"
            onChange={(height) => onPatchNumber(item, { height })}
          />
        </Field>
        <Field label={t("Position X")}>
          <NumberInput
            value={item.position.x}
            onChange={(x) =>
              onPatchNumber(item, { position: { ...item.position, x } })
            }
          />
        </Field>
        <Field label={t("Position Y")}>
          <NumberInput
            value={item.position.y}
            onChange={(y) =>
              onPatchNumber(item, { position: { ...item.position, y } })
            }
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-[12px] font-medium text-fg-2">
        <input
          type="checkbox"
          aria-label={t("Inherit style")}
          checked={inherits}
          onChange={(event) => setInherit(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        {t("Inherit group style")}</label>

      {!inherits && style ? (
        <div className="grid grid-cols-1 gap-2.5">
          <Field label={t("Fill color")}>
            <ColorInput
              value={fillColor}
              onChange={(color) =>
                patchStyle((current) => ({
                  ...current,
                  fill: { ...current.fill, type: "solid", color },
                }))
              }
            />
          </Field>
          <Field label={t("Stroke color")}>
            <ColorInput
              value={strokeColor}
              onChange={(color) =>
                patchStyle((current) => ({
                  ...current,
                  stroke: { ...current.stroke, color },
                }))
              }
            />
          </Field>
        </div>
      ) : null}
    </>
  );
}
