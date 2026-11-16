import type { Sequence, SeqClip, SeqMedia, SeqTrack, SeqTransition } from "./model";
import type { ReportItem } from "./report";
import { fpsOf } from "./timecode";

/**
 * Formats with no nested-sequence element (EDL here; FCPXML in this exporter)
 * get every nest expanded in place: the nested sequence's tracks are laid onto
 * extra tracks right above the track that held the nest, with frames converted
 * to the parent's rate and clipped to the span the nest clip actually shows.
 * Each expansion is reported, so nothing changes silently.
 */

export interface FlattenResult {
  readonly sequence: Sequence;
  readonly items: ReportItem[];
}

export const hasNests = (seq: Sequence): boolean => seq.tracks.some((t) => t.clips.some((c) => c.nested));

const convert = (frames: number, from: Sequence, to: Sequence): number =>
  from.rate.num === to.rate.num && from.rate.den === to.rate.den ? frames : Math.round((frames * fpsOf(to.rate)) / fpsOf(from.rate));

function placeClip(clip: SeqClip, nest: SeqClip, inner: Sequence, parent: Sequence): SeqClip | null {
  const offset = convert(Math.round(nest.inSec * fpsOf(inner.rate)), inner, parent);
  const length = nest.endFrame - nest.startFrame;
  const innerStart = convert(clip.startFrame, inner, parent) - offset;
  const innerEnd = Math.max(innerStart + 1, convert(clip.endFrame, inner, parent) - offset);
  const start = Math.max(0, innerStart);
  const end = Math.min(length, innerEnd);
  if (end <= start) return null;
  const fps = fpsOf(parent.rate);
  const headCut = start - innerStart;
  const tailCut = innerEnd - end;
  // Trim the source window by the cut frames (a retimed clip consumes `speed` source seconds per second).
  const headSec = (headCut / fps) * clip.speed;
  const tailSec = (tailCut / fps) * clip.speed;
  return {
    ...clip,
    startFrame: nest.startFrame + start,
    endFrame: nest.startFrame + end,
    inSec: clip.reversed ? clip.inSec + tailSec : clip.inSec + headSec,
    outSec: clip.reversed ? clip.outSec - headSec : clip.outSec - tailSec,
    opacity: clip.opacity * nest.opacity,
    volume: clip.volume * nest.volume,
  };
}

function placeTransition(tr: SeqTransition, nest: SeqClip, inner: Sequence, parent: Sequence): SeqTransition {
  const offset = convert(Math.round(nest.inSec * fpsOf(inner.rate)), inner, parent);
  return {
    ...tr,
    startFrame: nest.startFrame + convert(tr.startFrame, inner, parent) - offset,
    endFrame: nest.startFrame + convert(tr.endFrame, inner, parent) - offset,
  };
}

export function flattenNests(input: Sequence): FlattenResult {
  const items: ReportItem[] = [];
  const media = new Map<string, SeqMedia>(input.media.map((m) => [m.key, m]));
  const markers = [...input.markers];
  const out: SeqTrack[] = [];
  const surviving = (track: SeqTrack): SeqTrack => ({ ...track, clips: track.clips.filter((c) => !c.nested) });

  // Collect additions per host track so they can be stacked directly above it.
  const above = new Map<SeqTrack, SeqTrack[]>();
  for (const track of input.tracks) {
    for (const nest of track.clips) {
      if (!nest.nested) continue;
      const innerFlat = flattenNests(nest.nested);
      items.push(...innerFlat.items);
      const inner = innerFlat.sequence;
      for (const m of inner.media) media.set(m.key, m);
      let moved = 0;
      for (const it of inner.tracks) {
        const placed = it.clips.map((c) => placeClip(c, nest, inner, input)).filter((c): c is SeqClip => c !== null);
        if (placed.length === 0) continue;
        moved += placed.length;
        const extra: SeqTrack = {
          kind: it.kind === "audio" || track.kind === "audio" ? it.kind : "video",
          name: `${track.name} / ${nest.name} ${it.name}`,
          clips: placed,
          transitions: it.transitions.map((tr) => placeTransition(tr, nest, inner, input)),
          disabled: it.disabled || track.disabled,
          locked: track.locked,
        };
        above.set(track, [...(above.get(track) ?? []), extra]);
      }
      for (const m of inner.markers) {
        const frame = nest.startFrame + convert(m.frame, inner, input) - convert(Math.round(nest.inSec * fpsOf(inner.rate)), inner, input);
        if (frame >= nest.startFrame && frame < nest.endFrame) markers.push({ ...m, frame });
      }
      items.push({
        severity: "approximated",
        feature: "Nested sequence",
        detail: `"${nest.name}" was flattened into this sequence (${moved} clip${moved === 1 ? "" : "s"}${
          inner.rate.num / inner.rate.den !== input.rate.num / input.rate.den ? ", frames converted to the sequence rate" : ""
        }); this format has no nested sequences.`,
        clipId: nest.id,
        clipName: nest.name,
        trackName: track.name,
      });
      if (nest.speed !== 1 || nest.reversed) {
        items.push({
          severity: "approximated",
          feature: "Nested sequence retime",
          detail: `"${nest.name}" is retimed (${nest.reversed ? "reversed, " : ""}${nest.speed}x) but flattening lays its clips at normal speed.`,
          clipId: nest.id,
          clipName: nest.name,
          trackName: track.name,
        });
      }
    }
  }
  for (const track of input.tracks) {
    out.push(surviving(track));
    // Video: nested layers sit above their host. Audio: after it.
    for (const extra of above.get(track) ?? []) out.push(extra);
  }
  // Interchange order is "video bottom to top, then audio": keep every video track before every audio track.
  const video = out.filter((t) => t.kind === "video");
  const audio = out.filter((t) => t.kind === "audio");
  return {
    sequence: { ...input, tracks: [...video, ...audio], markers: markers.sort((a, b) => a.frame - b.frame), media: [...media.values()] },
    items,
  };
}
