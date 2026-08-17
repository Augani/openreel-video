import type { JSX } from "react";
import { useEffect, useState } from "react";
import {
  MOTION_OBJECT_3D_KINDS,
  type MotionObject3DKind,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
  type MotionSceneVector3,
} from "@openreel/core";
import { Plus, Trash2 } from "@/icons/lucide-compat";
import {
  ColorInput,
  Field,
  NumberInput,
  Section,
  SelectInput,
  Slider,
  TextInput,
} from "../primitives";
import { useTranslation } from "react-i18next";

interface Scene3DInspectorProps {
  readonly layer: MotionScene3DLayer;
  readonly replaceLayer: (layer: MotionScene3DLayer) => void;
}

const ZERO_VECTOR: MotionSceneVector3 = { x: 0, y: 0, z: 0 };

function Vector3Row({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  readonly label: string;
  readonly value: MotionSceneVector3 | undefined;
  readonly onChange: (next: MotionSceneVector3) => void;
  readonly step?: number;
}): JSX.Element {
  const vec = value ?? ZERO_VECTOR;
  return (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1.5">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberInput
            key={axis}
            value={vec[axis]}
            step={step}
            onChange={(next) => onChange({ ...vec, [axis]: next })}
          />
        ))}
      </div>
    </Field>
  );
}

const KIND_OPTIONS: Array<{ value: MotionObject3DKind; label: string }> =
  MOTION_OBJECT_3D_KINDS.map((kind) => ({ value: kind, label: kind }));

const makeObjectId = (): string =>
  `scene-obj-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function Scene3DInspector({
  layer,
  replaceLayer,
}: Scene3DInspectorProps): JSX.Element {
  const { t } = useTranslation();
  const objects = layer.objects ?? [];
  const [activeId, setActiveId] = useState<string>(objects[0]?.id ?? "");

  useEffect(() => {
    if (!objects.some((object) => object.id === activeId)) {
      setActiveId(objects[0]?.id ?? "");
    }
  }, [activeId, objects]);

  const active = objects.find((object) => object.id === activeId) ?? null;

  const updateObjects = (next: readonly MotionSceneObject3D[]): void => {
    replaceLayer({ ...layer, objects: next });
  };

  const patchActive = (patch: Partial<MotionSceneObject3D>): void => {
    if (!active) return;
    updateObjects(
      objects.map((object) =>
        object.id === active.id ? { ...object, ...patch } : object,
      ),
    );
  };

  const patchActiveObject = (
    patch: Partial<MotionSceneObject3D["object"]>,
  ): void => {
    if (!active) return;
    patchActive({ object: { ...active.object, ...patch } });
  };

  const addObject = (): void => {
    const id = makeObjectId();
    updateObjects([
      ...objects,
      {
        id,
        name: `Object ${objects.length + 1}`,
        object: { kind: "rounded-box", size: 0.5 },
        material: {
          kind: "physical",
          color: "#10b981",
          metalness: 0.1,
          roughness: 0.4,
        },
        transform3d: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ]);
    setActiveId(id);
  };

  const removeObject = (id: string): void => {
    if (objects.length <= 1) return;
    updateObjects(objects.filter((object) => object.id !== id));
  };

  return (
    <>
      <Section title={t("Objects")} keepOpenInAccordion>
        <div className="space-y-1">
          {objects.map((object) => (
            <div
              key={object.id}
              className={`flex items-center gap-2 rounded-[7px] border px-2 py-1.5 ${
                object.id === activeId
                  ? "border-accent bg-selected"
                  : "border-border bg-bg-1 hover:bg-bg-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(object.id)}
                className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-fg-2"
              >
                {object.name ?? object.object.kind}
              </button>
              {objects.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove ${object.name ?? "object"}`}
                  onClick={() => removeObject(object.id)}
                  className="shrink-0 text-fg-muted hover:text-status-error"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("Add object")}
          onClick={addObject}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-border-strong py-2 text-[12px] font-medium text-fg-2 hover:text-accent hover:border-accent"
        >
          <Plus size={13} aria-hidden /> {t(" Add object")}</button>
      </Section>

      {active ? (
        <>
        <Section title={t("Geometry")} keepOpenInAccordion>
          <Field label={t("Kind")}>
            <SelectInput
              value={active.object.kind}
              options={KIND_OPTIONS}
              placeholder={t("Geometry kind")}
              onChange={(value) =>
                value
                  ? patchActiveObject({ kind: value as MotionObject3DKind })
                  : undefined
              }
            />
          </Field>
          <Field label={t("Size")}>
            <NumberInput
              value={active.object.size ?? 0.5}
              min={0.05}
              max={2}
              step={0.05}
              onChange={(value) => patchActiveObject({ size: value })}
            />
          </Field>
          {active.object.kind === "model" ? (
            <Field label={t("Model URL (.glb / .gltf)")}>
              <TextInput
                value={active.object.modelUrl ?? ""}
                onChange={(value) => patchActiveObject({ modelUrl: value })}
                placeholder="https://…/model.glb"
              />
            </Field>
          ) : null}
          {active.object.kind === "text3d" ? (
            <Field label={t("Text")}>
              <TextInput
                value={active.object.text ?? ""}
                onChange={(value) => patchActiveObject({ text: value })}
                placeholder="3D"
              />
            </Field>
          ) : null}
        </Section>

        <Section title={t("Material")}>
          <Field label={t("Color")}>
            <div role="group" aria-label={t("Material color")}>
              <ColorInput
                value={active.material?.color ?? "#10b981"}
                onChange={(value) =>
                  patchActive({
                    material: { ...active.material, color: value },
                  })
                }
              />
            </div>
          </Field>
          <Field label={t("Metalness")}>
            <Slider
              value={active.material?.metalness ?? 0.1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({
                  material: { ...active.material, metalness: value },
                })
              }
            />
          </Field>
          <Field label={t("Roughness")}>
            <Slider
              value={active.material?.roughness ?? 0.4}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({
                  material: { ...active.material, roughness: value },
                })
              }
            />
          </Field>
          <Field label={t("Opacity")}>
            <Slider
              value={active.material?.opacity ?? 1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({
                  material: { ...active.material, opacity: value },
                })
              }
            />
          </Field>
        </Section>

        <Section title={t("Transform")}>
          <Vector3Row
            label={t("Position")}
            value={active.transform3d?.position}
            onChange={(next) =>
              patchActive({
                transform3d: { ...active.transform3d, position: next },
              })
            }
          />
          <Vector3Row
            label={t("Rotation")}
            value={active.transform3d?.rotation}
            step={1}
            onChange={(next) =>
              patchActive({
                transform3d: { ...active.transform3d, rotation: next },
              })
            }
          />
          <Vector3Row
            label={t("Scale")}
            value={active.transform3d?.scale}
            step={0.05}
            onChange={(next) =>
              patchActive({
                transform3d: { ...active.transform3d, scale: next },
              })
            }
          />
        </Section>
        </>
      ) : null}

      <Section title={t("Camera")}>
        <Field label={t("FOV")}>
          <div role="group" aria-label={t("Camera FOV")}>
            <NumberInput
              value={layer.camera?.fov ?? 35}
              min={10}
              max={120}
              step={1}
              onChange={(value) =>
                replaceLayer({
                  ...layer,
                  camera: { ...layer.camera, fov: value },
                })
              }
            />
          </div>
        </Field>
        <Vector3Row
          label={t("Position")}
          value={layer.camera?.position}
          onChange={(next) =>
            replaceLayer({
              ...layer,
              camera: { ...layer.camera, position: next },
            })
          }
        />
        <Vector3Row
          label={t("Target")}
          value={layer.camera?.target}
          onChange={(next) =>
            replaceLayer({
              ...layer,
              camera: { ...layer.camera, target: next },
            })
          }
        />
      </Section>
    </>
  );
}
