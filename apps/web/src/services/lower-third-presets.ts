import {
  resolveTimelinePlacement,
  TitleEngine,
  type TextStyle,
} from "@openreel/core";
import { EditingSession } from "./agent/editing-session";

export const LOWER_THIRD_PRESETS = [
  {
    id: "simple",
    name: "Simple lower third",
    text: "Your Name",
    subtitle: "Title, Company",
    style: { fontSize: 32, fontWeight: 700, color: "#ffffff", strokeWidth: 0 },
    subtitleStyle: { fontSize: 22, fontWeight: 400, color: "#c4c6cc", strokeWidth: 0 },
  },
  {
    id: "label",
    name: "Label lower third",
    text: "YOUR NAME",
    subtitle: "Title, Company",
    style: {
      fontSize: 32,
      fontWeight: 700,
      color: "#062a1d",
      backgroundColor: "#2bd49a",
      strokeWidth: 0,
    },
    subtitleStyle: {
      fontSize: 22,
      fontWeight: 400,
      color: "#111111",
      backgroundColor: "#ffffff",
      strokeWidth: 0,
    },
  },
] as const satisfies readonly {
  id: string;
  name: string;
  text: string;
  subtitle: string;
  style: Partial<TextStyle>;
  subtitleStyle: Partial<TextStyle>;
}[];

export type LowerThirdPresetId = (typeof LOWER_THIRD_PRESETS)[number]["id"];

/** Both editable lines and any required rows enter history as one edit. */
export async function addLowerThird(
  presetId: LowerThirdPresetId,
  startTime: number,
) {
  const preset = LOWER_THIRD_PRESETS.find((item) => item.id === presetId)!;
  const session = new EditingSession();
  const transaction = session.beginTransaction();
  const engine = new TitleEngine();
  const created: { id: string; trackId: string }[] = [];
  const duration = 5;
  const fontScale = session.getProject().settings.height / 1080;

  for (const [index, text] of [preset.text, preset.subtitle].entries()) {
    const project = session.getProject();
    const target =
      project.timeline.tracks.find(
        (track) => !track.locked && track.type === "text",
      ) ??
      project.timeline.tracks.find(
        (track) => !track.locked && track.type === "video",
      );
    const newTrackId = `track-${crypto.randomUUID()}`;
    const placement = target
      ? resolveTimelinePlacement(project, {
          targetTrackId: target.id,
          startTime,
          duration,
          policy: "stack-above",
          newTrackId,
        })
      : {
          ok: true as const,
          trackId: newTrackId,
          startTime: Math.max(0, startTime),
          createdTrack: { id: newTrackId, position: 0 },
        };
    if (!placement.ok)
      throw new Error("Could not place the lower third on the timeline.");
    if (placement.createdTrack) {
      const result = await session.applyAction({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: "track/add",
        params: {
          trackId: placement.trackId,
          trackType: "text",
          position: placement.createdTrack.position,
        },
      });
      if (!result.success)
        throw new Error(result.error?.message ?? "Could not add a text track.");
    }
    const labelled = preset.id === "label";
    const lineStyle =
      index === 0 ? preset.style : preset.subtitleStyle;
    const clip = engine.createTextClip({
      trackId: placement.trackId,
      startTime: placement.startTime,
      duration,
      text,
      style: {
        ...lineStyle,
        fontFamily: "Inter",
        fontSize: lineStyle.fontSize * fontScale,
        strokeWidth: 0,
        textAlign: labelled ? "center" : "left",
        verticalAlign: "middle",
        lineHeight: 1.1,
        letterSpacing: 0,
      },
      transform: { position: { x: 0.08, y: index === 0 ? 0.84 : 0.89 } },
    });
    // The renderer centers text backgrounds; keep both label edges aligned.
    const width = labelled ? engine.measureText(text, clip.style).width : 0;
    const positioned = labelled
      ? {
          ...clip,
          transform: {
            ...clip.transform,
            position: {
              ...clip.transform.position,
              x: 0.08 + width / (2 * project.settings.width),
            },
          },
        }
      : clip;
    const result = await session.applyAction({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: "text/create",
      params: { clip: positioned },
    });
    if (!result.success)
      throw new Error(
        result.error?.message ?? "Could not add lower-third text.",
      );
    created.push({ id: clip.id, trackId: clip.trackId });
  }
  try {
    await session.commitTransaction(
      transaction,
      `Add ${preset.name.toLowerCase()}`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("The project changed")
    ) {
      throw new Error(
        "The project changed while adding this lower third. Try again.",
      );
    }
    throw error;
  }
  return created;
}
