import type { JSX } from "react";
import {
  Crosshair,
  Eye,
  EyeOff,
  LocateFixed,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "@/icons/lucide-compat";
import {
  addMotionPuppetPin,
  clearMotionPuppetPins,
  createMotionPuppetPin,
  evaluateMotionPuppetPinsAtTime,
  getEditableMotionShapePathPoints,
  getMotionPuppetPinKeyframeProperty,
  removeMotionPuppetPin,
  setMotionLayerPropertyValue,
  updateMotionPuppetPin,
  upsertMotionLayerKeyframe,
  type MotionComposition,
  type MotionLayer,
  type MotionPuppetPin,
  type MotionPuppetPropertyName,
  type MotionShapeLayer,
  type MotionShapePathPoint,
} from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  Button,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  TextInput,
} from "./primitives";
import { useTranslation } from "react-i18next";

interface DeformPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const PIN_COLORS = [
  "#22d3ee",
  "#f97316",
  "#14b8a6",
  "#34d399",
  "#f43f5e",
  "#facc15",
] as const;

const makeId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function DeformPanel({
  composition,
  embedded = false,
}: DeformPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const playhead = useMotionStore((state) => state.playhead);
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const shapeLayer = selectedLayer?.type === "shape" ? selectedLayer : null;
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );

  const replaceLayer = (nextLayer: MotionShapeLayer) => {
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addPin = () => {
    if (!shapeLayer || shapeLayer.locked) return;
    const pins = shapeLayer.puppetPins ?? [];
    const bindPosition = getSuggestedPinPosition(
      shapeLayer,
      getLayerLocalTime(shapeLayer, playhead),
      pins.length,
    );
    const pin = createMotionPuppetPin({
      id: makeId("motion-puppet-pin"),
      name: `Pin ${pins.length + 1}`,
      bindPosition,
      position: bindPosition,
      radius: getSuggestedPinRadius(shapeLayer),
      strength: 1,
      color: PIN_COLORS[pins.length % PIN_COLORS.length],
    });
    replaceLayer(addMotionPuppetPin(shapeLayer, pin));
  };

  const patchPin = (
    pinId: string,
    updater: (pin: MotionPuppetPin) => MotionPuppetPin,
  ) => {
    if (!shapeLayer || shapeLayer.locked) return;
    replaceLayer(updateMotionPuppetPin(shapeLayer, pinId, updater));
  };

  const removePin = (pinId: string) => {
    if (!shapeLayer || shapeLayer.locked) return;
    replaceLayer(removeMotionPuppetPin(shapeLayer, pinId));
  };

  const clearPins = () => {
    if (!shapeLayer || shapeLayer.locked) return;
    replaceLayer(clearMotionPuppetPins(shapeLayer));
  };

  const setPinScalar = (
    pinId: string,
    property: MotionPuppetPropertyName,
    value: number,
  ) => {
    if (!shapeLayer || shapeLayer.locked) return;
    const keyframeProperty = getMotionPuppetPinKeyframeProperty(pinId, property);
    const nextLayer = shouldWritePuppetPropertyKeyframe(
      shapeLayer,
      keyframeProperty,
      autoKeyframe,
    )
      ? upsertMotionLayerKeyframe(shapeLayer, keyframeProperty, localTime, {
          value,
          easing: "ease",
        })
      : setMotionLayerPropertyValue(shapeLayer, keyframeProperty, value);
    replaceLayer(nextLayer);
  };

  const setPinPosition = (
    pinId: string,
    position: MotionShapePathPoint,
  ) => {
    if (!shapeLayer || shapeLayer.locked) return;
    let nextLayer: MotionShapeLayer = shapeLayer;
    for (const [property, value] of [
      ["position.x", position.x],
      ["position.y", position.y],
    ] as const) {
      const keyframeProperty = getMotionPuppetPinKeyframeProperty(pinId, property);
      nextLayer = shouldWritePuppetPropertyKeyframe(
        shapeLayer,
        keyframeProperty,
        autoKeyframe,
      )
        ? upsertMotionLayerKeyframe(nextLayer, keyframeProperty, localTime, {
            value,
            easing: "ease",
          })
        : setMotionLayerPropertyValue(nextLayer, keyframeProperty, value);
    }
    replaceLayer(nextLayer);
  };

  if (!selectedLayer) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title={t("Deform")} icon={Crosshair} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState icon={Crosshair} title={t("Select a shape layer")} />
        </div>
      </div>
    );
  }

  if (!shapeLayer) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title={t("Deform")} icon={Crosshair} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState icon={Crosshair} title={t("Shape layer required")} />
        </div>
      </div>
    );
  }

  const localTime = getLayerLocalTime(shapeLayer, playhead);
  const evaluatedShapeLayer = evaluateMotionPuppetPinsAtTime(
    shapeLayer,
    localTime,
  );
  const pins = evaluatedShapeLayer.puppetPins ?? [];
  const animatedPinPropertyCount = countPuppetPinKeyframes(shapeLayer);
  const pathPoints =
    shapeLayer.shapeType === "path"
      ? getEditableMotionShapePathPoints(shapeLayer, localTime)
      : [];

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : (
        <PanelHeader
          title={t("Deform")}
          icon={Crosshair}
          actions={
            <>
              {pins.length > 0 ? (
                <IconButton
                  icon={Trash2}
                  label={t("Clear pins")}
                  size="sm"
                  disabled={shapeLayer.locked}
                  onClick={clearPins}
                />
              ) : null}
              <IconButton
                icon={Plus}
                label={t("Add puppet pin")}
                size="sm"
                disabled={shapeLayer.locked}
                onClick={addPin}
              />
            </>
          }
        />
      )}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title={t("Layer")} icon={SlidersHorizontal}>
          <div className="rounded-md border border-border bg-bg-2 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] font-semibold text-fg-2">
                {shapeLayer.name}
              </span>
              <span className="shrink-0 rounded border border-border bg-bg-1 px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                {shapeLayer.shapeType}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px] text-fg-muted">
              <Metric label={t("Pins")} value={pins.length} />
              <Metric label={t("Path")} value={pathPoints.length || "-"} />
              <Metric
                label={t("Keys")}
                value={animatedPinPropertyCount || "-"}
              />
            </div>
          </div>
          <Button
            label={t("Add Puppet Pin")}
            icon={Plus}
            variant="solid"
            size="md"
            disabled={shapeLayer.locked}
            onClick={addPin}
            className="w-full"
          />
          {pins.length > 0 ? (
            <Button
              label={t("Clear pins")}
              icon={Trash2}
              variant="danger"
              size="sm"
              disabled={shapeLayer.locked}
              onClick={clearPins}
              className="w-full"
            />
          ) : null}
        </Section>

        <Section title={`Pins (${pins.length})`} icon={Crosshair}>
          {pins.length === 0 ? (
            <EmptyState icon={Crosshair} title={t("No pins")} />
          ) : (
            <div className="space-y-2.5">
              {pins.map((pin, index) => (
                <PuppetPinCard
                  key={pin.id}
                  disabled={shapeLayer.locked}
                  pin={pin}
                  color={pin.color ?? PIN_COLORS[index % PIN_COLORS.length]}
                  onPatch={(updater) => patchPin(pin.id, updater)}
                  onSetScalar={(property, value) =>
                    setPinScalar(pin.id, property, value)
                  }
                  onSetPosition={(position) => setPinPosition(pin.id, position)}
                  onRemove={() => removePin(pin.id)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function PuppetPinCard({
  pin,
  color,
  disabled,
  onPatch,
  onSetScalar,
  onSetPosition,
  onRemove,
}: {
  pin: MotionPuppetPin;
  color: string;
  disabled: boolean;
  onPatch: (updater: (pin: MotionPuppetPin) => MotionPuppetPin) => void;
  onSetScalar: (property: MotionPuppetPropertyName, value: number) => void;
  onSetPosition: (position: MotionShapePathPoint) => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const setBindAxis = (axis: "x" | "y", value: number) => {
    onPatch((current) => ({
      ...current,
      bindPosition: { ...current.bindPosition, [axis]: value },
    }));
  };

  return (
    <article className="rounded-md border border-border bg-bg-2 p-2.5">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/10"
          style={{ backgroundColor: color }}
        />
        <div className="min-w-0 flex-1">
          <TextInput
            value={pin.name}
            disabled={disabled}
            onChange={(name) => onPatch((current) => ({ ...current, name }))}
          />
        </div>
        <IconButton
          icon={pin.enabled ? Eye : EyeOff}
          label={pin.enabled ? t("Disable pin") : t("Enable pin")}
          active={pin.enabled}
          size="sm"
          disabled={disabled}
          onClick={() =>
            onPatch((current) => ({ ...current, enabled: !current.enabled }))
          }
        />
        <IconButton
          icon={Trash2}
          label={t("Delete pin")}
          size="sm"
          variant="danger"
          disabled={disabled}
          onClick={onRemove}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("Bind X")}>
          <NumberInput
            value={pin.bindPosition.x}
            step={1}
            disabled={disabled}
            onChange={(value) => setBindAxis("x", value)}
          />
        </Field>
        <Field label={t("Bind Y")}>
          <NumberInput
            value={pin.bindPosition.y}
            step={1}
            disabled={disabled}
            onChange={(value) => setBindAxis("y", value)}
          />
        </Field>
        <Field label={t("Position X")}>
          <NumberInput
            value={pin.position.x}
            step={1}
            disabled={disabled}
            onChange={(value) => onSetScalar("position.x", value)}
          />
        </Field>
        <Field label={t("Position Y")}>
          <NumberInput
            value={pin.position.y}
            step={1}
            disabled={disabled}
            onChange={(value) => onSetScalar("position.y", value)}
          />
        </Field>
        <Field label={t("Radius")}>
          <NumberInput
            value={pin.radius}
            min={1}
            step={5}
            unit="px"
            disabled={disabled}
            onChange={(value) => onSetScalar("radius", value)}
          />
        </Field>
        <Field label={t("Strength")}>
          <NumberInput
            value={pin.strength}
            min={0}
            max={2}
            step={0.05}
            disabled={disabled}
            onChange={(value) => onSetScalar("strength", value)}
          />
        </Field>
      </div>

      <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-2">
        <Field label={t("Color")}>
          <ColorInput
            value={pin.color ?? color}
            disabled={disabled}
            onChange={(value) =>
              onPatch((current) => ({ ...current, color: value }))
            }
          />
        </Field>
        <div className="flex items-end">
          <IconButton
            icon={LocateFixed}
            label={t("Reset position to bind")}
            variant="outline"
            disabled={disabled}
            onClick={() => onSetPosition(pin.bindPosition)}
          />
        </div>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): JSX.Element {
  return (
    <span className="rounded border border-border bg-bg-1 px-2 py-1">
      {label}: <span className="font-semibold text-fg-2">{value}</span>
    </span>
  );
}

function getSuggestedPinPosition(
  layer: MotionShapeLayer,
  localTime: number,
  index: number,
): MotionShapePathPoint {
  if (layer.shapeType === "path") {
    const points = getEditableMotionShapePathPoints(layer, localTime);
    if (points.length > 0) {
      return points[index % points.length];
    }
  }

  const offsets = [
    { x: 0, y: 0 },
    { x: -layer.width / 4, y: -layer.height / 4 },
    { x: layer.width / 4, y: -layer.height / 4 },
    { x: layer.width / 4, y: layer.height / 4 },
    { x: -layer.width / 4, y: layer.height / 4 },
  ];
  return offsets[index % offsets.length];
}

function getSuggestedPinRadius(layer: MotionShapeLayer): number {
  return Math.max(40, Math.min(260, Math.max(layer.width, layer.height) * 0.4));
}

function getLayerLocalTime(layer: MotionLayer, playhead: number): number {
  return Math.min(layer.duration, Math.max(0, playhead - layer.startTime));
}

function shouldWritePuppetPropertyKeyframe(
  layer: MotionShapeLayer,
  property: string,
  autoKeyframe: boolean,
): boolean {
  return (
    autoKeyframe ||
    layer.keyframes.some((keyframe) => keyframe.property === property)
  );
}

function countPuppetPinKeyframes(layer: MotionShapeLayer): number {
  return layer.keyframes.filter((keyframe) =>
    keyframe.property.startsWith("puppet."),
  ).length;
}
