import type { Project, MediaItem } from "../types/project";
import type {
  TemplateProjectContent,
  TemplateTimeline,
} from "../types/template";
import {
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_TRANSFORM,
  type TextClip,
} from "../text/types";

function copyMedia(item: MediaItem): MediaItem {
  const {
    blob,
    fileHandle: _handle,
    thumbnailUrl: _thumbnail,
    waveformData: _waveform,
    filmstripThumbnails: _filmstrip,
    thumbnailPixelAspect: _thumbnailPixelAspect,
    ...metadata
  } = item;
  const original =
    typeof Blob !== "undefined" && blob instanceof Blob ? blob : null;
  return {
    ...structuredClone(metadata),
    blob: original,
    fileHandle: null,
    thumbnailUrl: null,
    waveformData: null,
    isPlaceholder: original ? item.isPlaceholder : true,
  };
}

function copyTemplateProjectContent(
  content: TemplateProjectContent,
): TemplateProjectContent {
  const { mediaLibrary, ...saved } = content;
  return {
    ...structuredClone(saved),
    mediaLibrary: { items: (mediaLibrary?.items ?? []).map(copyMedia) },
  };
}

export function captureTemplateProjectContent(
  project: Project,
): TemplateProjectContent {
  const {
    id: _id,
    name: _name,
    createdAt: _created,
    modifiedAt: _modified,
    settings: _settings,
    timeline: _timeline,
    ...content
  } = project;
  return copyTemplateProjectContent(content);
}

/** Blob bytes are immutable; copy editable data without cloning native file-handle functions. */
export function copySavedTemplate<
  T extends { projectContent?: TemplateProjectContent },
>(template: T): T {
  const { projectContent, ...saved } = template;
  return {
    ...structuredClone(saved),
    ...(projectContent
      ? { projectContent: copyTemplateProjectContent(projectContent) }
      : {}),
  } as T;
}

export function restoreTemplateProjectContent(
  template: {
    projectContent?: TemplateProjectContent;
    timeline: Project["timeline"];
  },
  replacements: MediaItem[],
): TemplateProjectContent {
  const content = copyTemplateProjectContent(
    template.projectContent ?? { mediaLibrary: { items: [] } },
  );
  const legacy = (template.timeline as TemplateTimeline).graphics;
  const media = new Map(
    content.mediaLibrary.items.map((item) => [item.id, item]),
  );
  for (const item of replacements) media.set(item.id, copyMedia(item));
  return {
    ...content,
    ...(content.shapeClips === undefined && Array.isArray(legacy?.shapes)
      ? { shapeClips: structuredClone(legacy.shapes) }
      : {}),
    ...(content.svgClips === undefined && Array.isArray(legacy?.svgs)
      ? { svgClips: structuredClone(legacy.svgs) }
      : {}),
    ...(content.stickerClips === undefined && Array.isArray(legacy?.stickers)
      ? { stickerClips: structuredClone(legacy.stickers) }
      : {}),
    mediaLibrary: { items: [...media.values()] },
  };
}

interface TemplateTextValue {
  id: string;
  text: string;
  placeholderId: string;
  trackId?: string;
  startTime?: number;
  duration?: number;
  transform?: unknown;
}

/** Legacy placeholder records become saved text, preserving existing styles when present. */
export function materializeTemplateText(
  project: Project,
  values: TemplateTextValue[],
  placeholders: readonly { id: string; label: string }[],
  scriptable = false,
): Project {
  if (!values.length) return project;
  const clips = new Map(
    (project.textClips ?? []).map((clip) => [clip.id, clip]),
  );
  for (const value of values) {
    const existing = clips.get(value.id);
    if (existing) {
      clips.set(value.id, { ...existing, text: value.text });
      continue;
    }
    const track = project.timeline.tracks.find(
      (item) =>
        item.id === value.trackId ||
        item.clips.some((clip) => clip.id === value.id),
    );
    const source = track?.clips.find((clip) => clip.id === value.id);
    if (!track || (!source && value.startTime === undefined)) continue;
    const label =
      placeholders.find((item) => item.id === value.placeholderId)?.label ??
      "Text";
    const fontSize = scriptable
      ? /title|headline/i.test(label)
        ? 48
        : 32
      : /title/i.test(label)
        ? 32
        : 48;
    const clip: TextClip = {
      id: value.id,
      trackId: track.id,
      text: value.text,
      startTime: value.startTime ?? source!.startTime,
      duration: value.duration ?? source!.duration,
      style: {
        ...DEFAULT_TEXT_STYLE,
        fontFamily: "Inter",
        fontSize,
        fontWeight: 600,
        fontStyle: "normal",
        color: "#ffffff",
        textAlign: "center",
        verticalAlign: "middle",
        letterSpacing: 0,
        lineHeight: 1.2,
      },
      transform: structuredClone({
        ...DEFAULT_TEXT_TRANSFORM,
        ...(value.transform && typeof value.transform === "object"
          ? value.transform
          : (source?.transform ?? {})),
      }),
      animation: {
        preset: "fade",
        params: { easing: "ease-out" },
        inDuration: 0.5,
        outDuration: 0.3,
      },
      keyframes: structuredClone(source?.keyframes ?? []),
      ...(source?.effects ? { effects: structuredClone(source.effects) } : {}),
      // Template text wraps inside the frame instead of running off its edges (a long quote is clipped otherwise).
      metadata: { ...(source?.metadata ? structuredClone(source.metadata) : {}), wrapWidthRatio: 0.84 },
    };
    clips.set(clip.id, clip);
  }
  return { ...project, textClips: [...clips.values()] };
}
