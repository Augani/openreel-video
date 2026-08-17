import type { JSX } from "react";
import { useState } from "react";
import {
  Braces,
  Hash,
  Image as ImageIcon,
  Link2,
  Palette,
  Plus,
  ToggleLeft,
  Trash2,
  Type,
  Unlink2,
} from "@/icons/lucide-compat";
import {
  addMotionLayerVariableBinding,
  createMotionVariable,
  getCompatibleMotionVariableBindingTargets,
  getMotionVariableBindingTargetDefinition,
  removeMotionLayerVariableBinding,
  removeMotionCompositionVariable,
  updateMotionCompositionVariable,
  type MotionComposition,
  type MotionLayer,
  type MotionVariable,
  type MotionVariableBinding,
  type MotionVariableBindingTarget,
  type MotionVariableType,
} from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  TextInput,
  SelectInput,
  SwitchInput,
} from "./primitives";
import { useTranslation } from "react-i18next";

interface VariablesPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

const VARIABLE_TYPES: readonly MotionVariableType[] = [
  "text",
  "number",
  "color",
  "boolean",
  "media",
];

const VARIABLE_META: Record<
  MotionVariableType,
  { label: string; icon: typeof Type; dot: string }
> = {
  text: { label: "Text", icon: Type, dot: "bg-clip-text" },
  number: { label: "Number", icon: Hash, dot: "bg-status-info" },
  color: { label: "Color", icon: Palette, dot: "bg-accent" },
  boolean: { label: "Toggle", icon: ToggleLeft, dot: "bg-status-warning" },
  media: { label: "Media", icon: ImageIcon, dot: "bg-clip-video" },
};

export function VariablesPanel({
  composition,
  embedded = false,
}: VariablesPanelProps): JSX.Element {
  const { t } = useTranslation();
  const [bindingTargets, setBindingTargets] = useState<
    Record<string, MotionVariableBindingTarget>
  >({});
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;

  const updateComposition = (nextComposition: MotionComposition) => {
    void upsertMotionComposition(nextComposition);
  };

  const addVariable = (type: MotionVariableType) => {
    updateComposition({
      ...composition,
      variables: [...composition.variables, createMotionVariable(type)],
      modifiedAt: Date.now(),
    });
  };

  const updateVariable = (
    variableId: string,
    updater: (variable: MotionVariable) => MotionVariable,
  ) => {
    updateComposition(
      updateMotionCompositionVariable(composition, variableId, updater),
    );
  };

  const removeVariable = (variableId: string) => {
    updateComposition(removeMotionCompositionVariable(composition, variableId));
  };

  const replaceLayer = (nextLayer: MotionLayer) => {
    updateComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const bindVariableToSelectedLayer = (
    variable: MotionVariable,
    target: MotionVariableBindingTarget,
  ) => {
    if (!selectedLayer) return;
    replaceLayer(addMotionLayerVariableBinding(selectedLayer, variable, target));
  };

  const removeBinding = (layerId: string, bindingId: string) => {
    const layer = composition.layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    replaceLayer(removeMotionLayerVariableBinding(layer, bindingId));
  };

  const setBindingTarget = (
    variableId: string,
    target: MotionVariableBindingTarget,
  ) => {
    setBindingTargets((current) => ({ ...current, [variableId]: target }));
  };

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : (
        <PanelHeader
          title={t("Variables")}
          icon={Braces}
          actions={
            <div className="flex items-center gap-0.5">
              {VARIABLE_TYPES.map((type) => {
                const meta = VARIABLE_META[type];
                const Icon = meta.icon;
                return (
                  <IconButton
                    key={type}
                    icon={Icon}
                    label={`Add ${meta.label.toLowerCase()} variable`}
                    size="sm"
                    onClick={() => addVariable(type)}
                  />
                );
              })}
            </div>
          }
        />
      )}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title={t("Add Variable")} icon={Plus}>
          <div className="grid grid-cols-2 gap-2">
            {VARIABLE_TYPES.map((type) => {
              const meta = VARIABLE_META[type];
              const Icon = meta.icon;
              return (
                <ToolcraftClickableCard
                  key={type}
                  label={`Add ${meta.label} variable`}
                  onClick={() => addVariable(type)}
                  variant="muted"
                  padding={2}
                  className="min-h-[54px]"
                >
                  <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-1 text-fg-3">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <ToolcraftText type="label" color="primary" weight="semibold" maxLines={1}>
                      {t(meta.label)}
                    </ToolcraftText>
                    <ToolcraftText type="supporting" color="secondary">
                      {t("Template value")}</ToolcraftText>
                  </span>
                  </span>
                </ToolcraftClickableCard>
              );
            })}
          </div>
        </Section>

        <Section title={`Variables (${composition.variables.length})`} icon={Braces}>
          {composition.variables.length === 0 ? (
            <EmptyState
              icon={Braces}
              title={t("No variables yet")}
              description={t("Add reusable text, color, number, media, or toggle values for templates and AI-generated scenes.")}
            />
          ) : (
            <div className="space-y-2.5">
              {composition.variables.map((variable) => (
                <VariableCard
                  key={variable.id}
                  composition={composition}
                  variable={variable}
                  selectedLayer={selectedLayer}
                  bindingTarget={bindingTargets[variable.id]}
                  onBindingTargetChange={(target) =>
                    setBindingTarget(variable.id, target)
                  }
                  onBind={(target) => bindVariableToSelectedLayer(variable, target)}
                  onRemoveBinding={removeBinding}
                  onUpdate={(updater) => updateVariable(variable.id, updater)}
                  onRemove={() => removeVariable(variable.id)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function VariableCard({
  composition,
  variable,
  selectedLayer,
  bindingTarget,
  onBindingTargetChange,
  onBind,
  onRemoveBinding,
  onUpdate,
  onRemove,
}: {
  composition: MotionComposition;
  variable: MotionVariable;
  selectedLayer: MotionLayer | null;
  bindingTarget: MotionVariableBindingTarget | undefined;
  onBindingTargetChange: (target: MotionVariableBindingTarget) => void;
  onBind: (target: MotionVariableBindingTarget) => void;
  onRemoveBinding: (layerId: string, bindingId: string) => void;
  onUpdate: (updater: (variable: MotionVariable) => MotionVariable) => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const meta = VARIABLE_META[variable.type];
  const Icon = meta.icon;
  const compatibleTargets = selectedLayer
    ? getCompatibleMotionVariableBindingTargets(selectedLayer, variable)
    : [];
  const compatibleTargetIds = new Set(
    compatibleTargets.map((target) => target.target),
  );
  const selectedTarget =
    bindingTarget && compatibleTargetIds.has(bindingTarget)
      ? bindingTarget
      : compatibleTargets[0]?.target ?? "layer.visible";
  const existingBindings = getVariableBindings(composition, variable.id);
  return (
    <div className="rounded-lg border border-border bg-bg-2">
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-1 text-fg-3">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-fg-2">
            {variable.name}
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] text-fg-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {t(meta.label)}
          </span>
        </span>
        <IconButton
          icon={Trash2}
          label={t("Remove variable")}
          size="sm"
          variant="danger"
          onClick={onRemove}
        />
      </div>
      <div className="space-y-3 p-3">
        <Field label={t("Name")}>
          <TextInput
            value={variable.name}
            onChange={(name) =>
              onUpdate((current) => ({
                ...current,
                name,
              }))
            }
          />
        </Field>
        <Field label={t("Type")}>
          <SelectInput
            value={variable.type}
            options={VARIABLE_TYPES.map((type) => ({
              value: type,
              label: t(VARIABLE_META[type].label),
            }))}
            onChange={(type) =>
              onUpdate((current) => ({
                ...current,
                type: type as MotionVariableType,
              }))
            }
          />
        </Field>
        <VariableValueControl variable={variable} onUpdate={onUpdate} />
        <div className="rounded-md border border-border bg-bg-1 p-2.5">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-3">
            <Link2 size={12} className="text-fg-muted" />
            {t("Bindings")}</div>
          {selectedLayer && compatibleTargets.length > 0 ? (
            <div className="flex items-end gap-2">
              <Field label={t("Selected layer target")}>
                <SelectInput
                  value={selectedTarget}
                  options={compatibleTargets.map((target) => ({
                    value: target.target,
                    label: t(target.label),
                  }))}
                  onChange={(target) =>
                    onBindingTargetChange(target as MotionVariableBindingTarget)
                  }
                />
              </Field>
              <IconButton
                icon={Link2}
                label={t("Bind variable to selected layer")}
                variant="outline"
                onClick={() => onBind(selectedTarget)}
              />
            </div>
          ) : (
            <ToolcraftText type="supporting" color="secondary" className="text-[11px] leading-relaxed text-fg-muted">
              {t("Select a compatible layer to bind this variable.")}</ToolcraftText>
          )}

          {existingBindings.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {existingBindings.map(({ layer, binding }) => {
                const definition = getMotionVariableBindingTargetDefinition(
                  binding.target,
                );
                return (
                  <div
                    key={binding.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg-2 px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium text-fg-2">
                        {layer.name}
                      </span>
                      <span className="block truncate text-[10.5px] text-fg-muted">
                        {definition?.label ?? binding.target}
                      </span>
                    </span>
                    <IconButton
                      icon={Unlink2}
                      label={t("Remove binding")}
                      size="sm"
                      variant="danger"
                      onClick={() => onRemoveBinding(layer.id, binding.id)}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function VariableValueControl({
  variable,
  onUpdate,
}: {
  variable: MotionVariable;
  onUpdate: (updater: (variable: MotionVariable) => MotionVariable) => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (variable.type === "number") {
    return (
      <Field label={t("Value")}>
        <NumberInput
          value={typeof variable.value === "number" ? variable.value : 0}
          onChange={(value) =>
            onUpdate((current) => ({
              ...current,
              value,
            }))
          }
        />
      </Field>
    );
  }

  if (variable.type === "color") {
    return (
      <Field label={t("Value")}>
        <ColorInput
          value={typeof variable.value === "string" ? variable.value : "#14b8a6"}
          onChange={(value) =>
            onUpdate((current) => ({
              ...current,
              value,
            }))
          }
        />
      </Field>
    );
  }

  if (variable.type === "boolean") {
    return (
      <SwitchInput
        label={t("Value")}
        checked={Boolean(variable.value)}
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            value,
          }))
        }
      />
    );
  }

  return (
    <Field label={t("Value")}>
      <TextInput
        value={String(variable.value)}
        placeholder={variable.type === "media" ? t("Media placeholder id") : undefined}
        onChange={(value) =>
          onUpdate((current) => ({
            ...current,
            value,
          }))
        }
      />
    </Field>
  );
}

function getVariableBindings(
  composition: MotionComposition,
  variableId: string,
): Array<{ readonly layer: MotionLayer; readonly binding: MotionVariableBinding }> {
  return composition.layers.flatMap((layer) =>
    (layer.variableBindings ?? [])
      .filter((binding) => binding.variableId === variableId)
      .map((binding) => ({ layer, binding })),
  );
}
