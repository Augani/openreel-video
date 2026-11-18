import type { Clip } from "../types/timeline";
import type { Project } from "../types/project";
import type { Sequence, SeqClip, SeqTrack } from "./model";
import { expectedMemberIds } from "../graphic-templates/instances";
import { isBakeStale } from "../linked-comps/linked-comps";

/**
 * The export report: every OpenReel feature that an interchange export drops
 * or approximates, per clip, so nothing disappears silently. `projectUnsupported`
 * lists what NO interchange format can carry (the neutral sequence has no slot
 * for it); `formatItems` adds what one particular format cannot carry.
 */

export type ReportSeverity = "dropped" | "approximated";

export interface ReportItem {
  readonly severity: ReportSeverity;
  /** Short feature label: "Video effects", "Speed ramp", "Sync lock"... */
  readonly feature: string;
  readonly detail: string;
  readonly clipId?: string;
  readonly clipName?: string;
  readonly trackName?: string;
}

export type ExportFormatId = "xmeml" | "fcpxml" | "edl" | "otio" | "aaf";

export interface ExportReport {
  readonly format: ExportFormatId;
  readonly items: ReportItem[];
  readonly dropped: number;
  readonly approximated: number;
  /** Informational lines that are neither dropped nor approximated (e.g. what AAF does not carry). */
  readonly notes: readonly string[];
  /** Items grouped by feature, in first-seen order. */
  readonly byFeature: { feature: string; severity: ReportSeverity; count: number }[];
}

interface Where {
  clipId?: string;
  clipName?: string;
  trackName?: string;
}

const item = (severity: ReportSeverity, feature: string, detail: string, where: Where = {}): ReportItem => ({
  severity,
  feature,
  detail,
  ...where,
});

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

const labelOf = (name: string): string => (name.length > 40 ? `${name.slice(0, 37)}...` : name);

/** Features of one media clip that the neutral sequence cannot represent. */
export function clipUnsupported(clip: Clip, clipName: string, trackName: string): ReportItem[] {
  const where = { clipId: clip.id, clipName, trackName };
  const out: ReportItem[] = [];
  const effects = (clip.effects ?? []).filter((e) => e.enabled);
  if (effects.length) {
    out.push(
      item("dropped", "Video effects", `${effects.map((e) => e.type).join(", ")} not exported; the clip is exported without them.`, where),
    );
  }
  const audioEffects = (clip.audioEffects ?? []).filter((e) => e.enabled);
  if (audioEffects.length) {
    out.push(item("dropped", "Audio effects", `${audioEffects.map((e) => e.type).join(", ")} not exported.`, where));
  }
  if (clip.colorGrading) out.push(item("dropped", "Color grading", "Color wheels, curves and LUTs are not exported.", where));
  if (clip.chromaKey) out.push(item("dropped", "Chroma key", "The chroma key is not exported.", where));
  const t = clip.transform;
  if (
    t &&
    (!near(t.position.x, 0) ||
      !near(t.position.y, 0) ||
      !near(t.scale.x, 1) ||
      !near(t.scale.y, 1) ||
      !near(t.rotation, 0))
  ) {
    out.push(item("dropped", "Position / scale / rotation", "Motion transform is not exported; the clip is placed at its default fit.", where));
  }
  if ((clip.blendMode && clip.blendMode !== "normal") || (clip.blendOpacity !== undefined && clip.blendOpacity !== 1)) {
    out.push(item("dropped", "Blend mode", `Blend mode ${clip.blendMode ?? "normal"} is not exported.`, where));
  }
  if (clip.fade && (clip.fade.fadeIn > 0 || clip.fade.fadeOut > 0)) {
    out.push(item("dropped", "Clip fades", "Fade in / fade out handles are not exported; add a dissolve in the target editor.", where));
  }
  if (clip.automation?.volume?.length || clip.automation?.pan?.length) {
    out.push(item("dropped", "Audio automation", "Volume and pan automation is not exported; only the clip's static level is.", where));
  }
  if (clip.keyframes?.length) {
    out.push(item("dropped", "Keyframes", `${clip.keyframes.length} keyframe(s) are not exported; the clip uses its static values.`, where));
  }
  if (clip.speedKeyframes?.length) {
    out.push(
      item(
        "approximated",
        "Speed ramp",
        `Speed ramp (${clip.speedKeyframes.length} points) is flattened to the constant speed ${clip.speed ?? 1}x.`,
        where,
      ),
    );
  }
  if (clip.freezeFrames?.length) {
    out.push(item("dropped", "Freeze frames", `${clip.freezeFrames.length} freeze frame(s) are not exported.`, where));
  }
  if (clip.stabilization?.enabled) out.push(item("dropped", "Stabilization", "Warp stabilization is not exported.", where));
  if (clip.emphasisAnimation) out.push(item("dropped", "Emphasis animation", "The emphasis animation is not exported.", where));
  if (clip.audioTrackIndex) {
    out.push(item("dropped", "Audio stream selection", `Source audio stream ${clip.audioTrackIndex + 1} is not selected in the export.`, where));
  }
  return out;
}

/** Everything no interchange format carries: clip features, track racks, non-timeline items. */
export function projectUnsupported(
  project: Project,
  nameOfClip: (clip: Clip) => string,
  /** Track ids of OTHER sequences: their overlays are reported with their own sequence, not this one. */
  foreignTrackIds: ReadonlySet<string> = new Set(),
): ReportItem[] {
  const out: ReportItem[] = [];
  const reported = new Set<string>();
  const trackName = (id: string): string => project.timeline.tracks.find((t) => t.id === id)?.name ?? "";

  interface Extra {
    id: string;
    trackId: string;
    feature: string;
    name: string;
  }
  const extras: Extra[] = [];
  for (const c of project.textClips ?? []) {
    extras.push({ id: c.id, trackId: c.trackId, feature: "Text clip", name: labelOf(c.text.replace(/\s+/g, " ")) });
  }
  for (const c of project.shapeClips ?? []) extras.push({ id: c.id, trackId: c.trackId, feature: "Shape clip", name: c.id });
  for (const c of project.svgClips ?? []) extras.push({ id: c.id, trackId: c.trackId, feature: "SVG graphic", name: c.id });
  for (const c of project.stickerClips ?? []) extras.push({ id: c.id, trackId: c.trackId, feature: "Sticker", name: c.id });
  for (const c of project.adjustmentLayers ?? []) {
    extras.push({ id: c.id, trackId: c.trackId, feature: "Adjustment layer", name: c.name });
  }
  for (const c of project.motionInstances ?? []) {
    extras.push({ id: c.id, trackId: c.trackId ?? "", feature: "Motion graphic", name: c.name ?? c.id });
  }
  // Nest clips on the timeline are exported (as nests, or flattened with their own report entry).
  // Only a legacy instance that has no clip on a track here is left out.
  const clipIdsOnTracks = new Set(project.timeline.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  for (const c of project.nestedInstances ?? []) {
    if (clipIdsOnTracks.has(c.id)) continue;
    const compound = (project.compoundClips ?? []).find((k) => k.id === c.compoundClipId);
    extras.push({ id: c.id, trackId: c.trackId, feature: "Nested sequence", name: compound?.name ?? c.compoundClipId });
  }
  // Linked compositions are one entry each, not one per layer.
  const linkedMembers = new Set<string>();
  const linked = (project.graphicInstances ?? []).filter((instance) => instance.linkedCompositionId);
  for (const instance of linked) {
    for (const id of expectedMemberIds(instance, project.settings)) linkedMembers.add(id);
    const trackId = instance.bake?.originalTrackId ?? instance.trackId;
    if (foreignTrackIds.has(trackId)) continue;
    const where = { clipId: instance.bake?.clipId ?? instance.id, clipName: instance.name, trackName: trackName(instance.trackId) };
    if (instance.bake) {
      out.push(
        item(
          "approximated",
          "Linked composition",
          isBakeStale(project, instance)
            ? `"${instance.name}" was flattened to its rendered clip, which is out of date: the composition was edited after it was rendered. Restore Unrendered and render again to export the current look.`
            : `"${instance.name}" was flattened to its rendered clip; the other tool receives the picture, not the live composition.`,
          where,
        ),
      );
    } else {
      out.push(
        item(
          "dropped",
          "Linked composition",
          `"${instance.name}" is a live composition and cannot be flattened into this format without a render. Use Render and Replace on it first to export its picture.`,
          where,
        ),
      );
    }
  }
  for (const n of extras) {
    if (linkedMembers.has(n.id)) {
      reported.add(n.id);
      continue;
    }
    reported.add(n.id);
    if (foreignTrackIds.has(n.trackId)) continue;
    out.push(
      item(
        "dropped",
        n.feature,
        n.feature === "Nested sequence"
          ? "This nested instance is not on the timeline and was not exported."
          : `${n.feature} is not part of the interchange formats and was left out.`,
        { clipId: n.id, clipName: n.name, trackName: trackName(n.trackId) },
      ),
    );
  }
  if (project.timeline.subtitles.length) {
    out.push(item("dropped", "Captions", `${project.timeline.subtitles.length} caption(s) are not exported; export SRT/VTT separately.`));
  }
  if (project.timeline.masterAudioRack?.effects.length) {
    out.push(item("dropped", "Master audio rack", "The master bus effect rack is not exported."));
  }
  if (project.timeline.audioBuses?.length) {
    out.push(item("dropped", "Audio buses", `${project.timeline.audioBuses.length} submix bus(es), track outputs and sends are not exported; the tracks mix straight to the master in the other tool.`));
  }
  const mediaIds = new Set(project.mediaLibrary.items.map((m) => m.id));
  for (const track of project.timeline.tracks) {
    const isMediaTrack = track.type === "video" || track.type === "image" || track.type === "audio";
    if (!isMediaTrack) {
      for (const c of track.clips.filter((k) => !reported.has(k.id))) {
        out.push(
          item("dropped", "Text / graphics track", `Clip on a ${track.type} track is not exported.`, {
            clipId: c.id,
            clipName: c.id,
            trackName: track.name,
          }),
        );
      }
      continue;
    }
    if (track.audioRack?.effects.length) {
      out.push(item("dropped", "Track effect rack", `${track.audioRack.effects.length} track effect(s) are not exported.`, { trackName: track.name }));
    }
    if (track.solo) out.push(item("dropped", "Solo", "Solo state is not exported.", { trackName: track.name }));
    for (const clip of track.clips) {
      if (!mediaIds.has(clip.mediaId)) continue; // reported as missing media by projectToSequence
      out.push(...clipUnsupported(clip, nameOfClip(clip), track.name));
    }
  }
  return out;
}

/** Per-format additions to the base report: what this one format cannot carry. */
export function formatItems(
  format: ExportFormatId,
  seq: Sequence,
  /** Interchange track name ("V1") -> the track's name in the OpenReel project. */
  trackNames: Readonly<Record<string, string>> = {},
): ReportItem[] {
  const out: ReportItem[] = [];
  const label = (t: SeqTrack): string => trackNames[t.name] ?? t.name;
  const syncDropped = (why: string): void => {
    for (const t of seq.tracks) {
      if (t.syncLock === false) out.push(item("dropped", "Sync lock", `Sync lock is off on this track; ${why}`, { trackName: label(t) }));
    }
  };
  const targetDropped = (why: string): void => {
    for (const t of seq.tracks) {
      if (t.targeted) out.push(item("dropped", "Track targeting", `This track is targeted; ${why}`, { trackName: label(t) }));
    }
  };
  const lockDropped = (): void => {
    for (const t of seq.tracks) {
      if (t.locked) out.push(item("dropped", "Track lock", "The track lock is not stored by this format.", { trackName: label(t) }));
    }
  };
  const videoTracks = seq.tracks.filter((t) => t.kind === "video");
  const audioTracks = seq.tracks.filter((t) => t.kind === "audio");
  const perClip = (t: SeqTrack, pick: (c: SeqClip) => ReportItem | null): void => {
    for (const c of t.clips) {
      const r = pick(c);
      if (r) out.push({ ...r, clipId: c.id, clipName: c.name, trackName: label(t) });
    }
  };

  if (format === "xmeml") {
    syncDropped("xmeml has no sync-lock field, so it is not carried (locked, enabled and targeting are).");
  } else if (format === "fcpxml") {
    syncDropped("FCPXML has no sync-lock field.");
    targetDropped("FCPXML has no track targeting.");
    lockDropped();
    videoTracks.forEach((t, i) => {
      for (const tr of t.transitions) {
        if (i > 0) {
          out.push(
            item("dropped", "Transition", `Transition at frame ${tr.startFrame} on a connected lane is not exported; FCPXML transitions live on the primary storyline only.`, {
              trackName: label(t),
            }),
          );
        } else if (tr.kind !== "dissolve") {
          out.push(item("approximated", "Transition", `${tr.kind} at frame ${tr.startFrame} is exported as a cross dissolve.`, { trackName: label(t) }));
        }
      }
    });
  } else if (format === "edl") {
    syncDropped("CMX3600 has no sync-lock field.");
    targetDropped("CMX3600 has no track targeting.");
    lockDropped();
    for (const t of audioTracks) {
      if (t.clips.length) {
        out.push(item("dropped", "Audio track", `${t.clips.length} audio clip(s) not exported; an EDL is video-only here.`, { trackName: label(t) }));
      }
    }
    for (const t of videoTracks) {
      perClip(t, (c) => (c.withAudio ? item("dropped", "Clip audio", "The clip's own audio is not exported (video-only EDL).") : null));
      perClip(t, (c) => (c.opacity !== 1 ? item("dropped", "Opacity", `Opacity ${Math.round(c.opacity * 100)}% is not exported.`) : null));
      perClip(t, (c) => (c.volume !== 1 ? item("dropped", "Clip level", "The clip's audio level is not exported.") : null));
      for (const tr of t.transitions) {
        if (tr.kind !== "dissolve") {
          out.push(item("approximated", "Transition", `${tr.kind} at frame ${tr.startFrame} is exported as a dissolve.`, { trackName: label(t) }));
        }
      }
      if (t.disabled) {
        out.push(item("dropped", "Track enabled", "The track is hidden; EDLs have no enabled flag, so its events are exported.", { trackName: label(t) }));
      }
    }
    for (const m of seq.markers) {
      out.push(item("dropped", "Marker", `Marker "${m.name}" at frame ${m.frame} is not written (no marker lines in this EDL).`));
    }
  } else if (format === "aaf") {
    syncDropped("AAF has no sync-lock field.");
    targetDropped("AAF has no track targeting.");
    lockDropped();
    for (const t of seq.tracks) {
      for (const tr of t.transitions) {
        if (tr.kind !== "dissolve") {
          out.push(item("approximated", "Transition", `${tr.kind} at frame ${tr.startFrame} is written as a video dissolve.`, { trackName: label(t) }));
        }
      }
      if (t.kind === "video") {
        perClip(t, (c) => (c.opacity !== 1 ? item("dropped", "Opacity", `Opacity ${Math.round(c.opacity * 100)}% is not written.`) : null));
      }
      if (t.kind === "audio") {
        perClip(t, (c) => (Math.abs(c.speed - 1) > 1e-6 || c.reversed ? item("approximated", "Audio speed", "Audio retiming is not written; the clip keeps its source range at the timeline length.") : null));
      }
      if (t.disabled) {
        out.push(item("dropped", t.kind === "video" ? "Track enabled" : "Track mute", t.kind === "video" ? "The track is hidden; AAF tracks have no enabled flag, so its clips are written as normal." : "The track is muted; AAF tracks have no mute flag, so its clips are written as normal.", { trackName: label(t) }));
      }
    }
    for (const m of seq.markers) {
      if (m.color) out.push(item("dropped", "Marker colour", `Marker "${m.name}": the colour is not written.`));
    }
  } else {
    for (const t of seq.tracks) {
      for (const tr of t.transitions) {
        if (tr.kind !== "dissolve") {
          out.push(
            item("approximated", "Transition", `${tr.kind} at frame ${tr.startFrame} is written as a Custom_Transition; other tools may treat it as a dissolve.`, {
              trackName: label(t),
            }),
          );
        }
      }
      perClip(t, (c) =>
        c.opacity !== 1 || c.volume !== 1
          ? item("approximated", "Opacity / level", "Opacity and audio level are stored in OpenReel metadata; other tools ignore them.")
          : null,
      );
    }
  }
  return out;
}

export function buildExportReport(format: ExportFormatId, items: readonly ReportItem[], notes: readonly string[] = []): ExportReport {
  const byFeature: { feature: string; severity: ReportSeverity; count: number }[] = [];
  for (const it of items) {
    const row = byFeature.find((r) => r.feature === it.feature && r.severity === it.severity);
    if (row) row.count++;
    else byFeature.push({ feature: it.feature, severity: it.severity, count: 1 });
  }
  return {
    format,
    items: [...items],
    notes: [...notes],
    dropped: items.filter((i) => i.severity === "dropped").length,
    approximated: items.filter((i) => i.severity === "approximated").length,
    byFeature,
  };
}
