import type { Clip, ClipColorGrading } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";
import { EditingSession } from "./agent/editing-session";
import type { EditorEffectDropPayload } from "../components/editor/timeline/effect-drop";
import { useInspectorNavigationStore } from "../stores/inspector-navigation-store";
import { useUIStore } from "../stores/ui-store";

/** Red-fastest 17³ RGB table, using the same indexing as imported .cube LUTs. */
export function createWarmLut(): NonNullable<ClipColorGrading["lut"]> {
  const size = 17;
  const data: number[] = [];
  const byte = (value: number) =>
    Math.round(Math.max(0, Math.min(1, value)) * 255);
  for (let blue = 0; blue < size; blue++) {
    for (let green = 0; green < size; green++) {
      for (let red = 0; red < size; red++) {
        const r = red / (size - 1),
          g = green / (size - 1),
          b = blue / (size - 1);
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        data.push(
          byte(luma + (r - luma) * 1.04 + 0.06 * luma * (1 - r)),
          byte(luma + (g - luma) * 1.04 + 0.015 * luma * (1 - g)),
          byte(luma + (b - luma) * 1.04 - 0.08 * luma * b),
        );
      }
    }
  }
  return { size, data, intensity: 1 };
}

async function updateClipLut(
  clipId: string,
  update: (clip: Clip) => Pick<Clip, "colorGrading" | "metadata">,
): Promise<boolean> {
  const session = new EditingSession();
  try {
    const transaction = session.beginTransaction();
    const project = session.getProject();
    const track = project.timeline.tracks.find((candidate) =>
      candidate.clips.some((clip) => clip.id === clipId),
    );
    const clip = track?.clips.find((candidate) => candidate.id === clipId);
    const media = project.mediaLibrary.items.find(
      (item) => item.id === clip?.mediaId,
    );
    if (
      !clip ||
      track?.locked ||
      (media?.type !== "video" && media?.type !== "image")
    )
      return false;
    const changes = update(clip);
    session.replaceDraft({
      ...project,
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((candidate) => ({
          ...candidate,
          clips: candidate.clips.map((item) =>
            item.id === clipId ? { ...item, ...changes } : item,
          ),
        })),
      },
    });
    await session.commitTransaction(transaction, "Adjust LUT");
    return true;
  } catch {
    return false;
  }
}

export async function applyEditorEffectToClip(
  clipId: string,
  effect: EditorEffectDropPayload,
): Promise<boolean> {
  if (effect.effectType === "stabilize") {
    const { project } = useProjectStore.getState();
    const track = project.timeline.tracks.find(item => item.clips.some(clip => clip.id === clipId));
    const clip = track?.clips.find(item => item.id === clipId);
    if (!clip || track?.locked || project.mediaLibrary.items.find(item => item.id === clip.mediaId)?.type !== "video") return false;
    useUIStore.getState().select({ type: "clip", id: clipId });
    useInspectorNavigationStore.getState().requestSection("stabilization", clipId);
    return true;
  }
  if (effect.effectType !== "lut")
    return !!(await useProjectStore
      .getState()
      .addVideoEffect(clipId, effect.effectType, effect.effectParams));
  if (effect.effectParams?.preset && effect.effectParams.preset !== "warm")
    return false;
  return updateClipLut(clipId, (clip) => ({
    colorGrading: { ...clip.colorGrading, lut: createWarmLut() },
    metadata: { ...clip.metadata, workspaceLutIntensity: 1 },
  }));
}

export async function setClipLutEnabled(
  clipId: string,
  enabled: boolean,
): Promise<boolean> {
  return updateClipLut(clipId, (clip) => {
    const lut = clip.colorGrading?.lut;
    if (!lut) throw new Error("This clip has no LUT.");
    const previous = Number(clip.metadata?.workspaceLutIntensity ?? 1);
    return {
      colorGrading: {
        ...clip.colorGrading,
        lut: {
          ...lut,
          intensity: enabled ? Math.max(0.01, Math.min(1, previous)) : 0,
        },
      },
      metadata: {
        ...clip.metadata,
        workspaceLutIntensity: lut.intensity > 0 ? lut.intensity : previous,
      },
    };
  });
}

export async function removeClipLut(clipId: string): Promise<boolean> {
  return updateClipLut(clipId, (clip) => {
    const { lut: _lut, ...colorGrading } = clip.colorGrading ?? {};
    const { workspaceLutIntensity: _intensity, ...metadata } =
      clip.metadata ?? {};
    return { colorGrading, metadata };
  });
}
