import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { ActionExecutor } from "../actions/action-executor";
import { ActionHistory } from "../actions/action-history";
import {
  buildSourceGroups,
  isMultichannelSource,
  matchSourceLayoutPreset,
  resolveSourceChannelGroups,
  sourceAudioShape,
  flattenedSourceChannels,
  type SourceLayoutPreset,
} from "../audio/source-channels";
import { planSourceEdit } from "./source-edit";
import { applyTimelineToolEdits, invertTimelineToolEdits, validateTimelineToolEdits } from "./timeline-tool-edit";

const media = (id: string, channels: number, streams = 1, extra: object = {}) => ({
  id, name: `${id}.wav`, type: "audio", fileHandle: null, blob: null, thumbnailUrl: null, waveformData: null,
  metadata: { duration: 10, width: 0, height: 0, frameRate: 0, sampleRate: 48000, channels, audioTrackCount: streams, codec: "pcm", fileSize: 1, hasAudio: true },
  ...extra,
});
const mk = (items: unknown[], tracks: unknown[] = []): Project =>
  ({
    id: "p", name: "p", createdAt: 1, modifiedAt: 1,
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items },
    timeline: { tracks, subtitles: [], markers: [], duration: 0 },
  }) as unknown as Project;
const aTrack = (id: string) => ({ id, name: id, type: "audio", clips: [], transitions: [], locked: false, hidden: false, muted: false, solo: false });

describe("verify: 5.1 and mixed layouts", () => {
  const six = media("six", 6);
  it("5.1 file is one 5.1 clip by default, and regroups by preset", () => {
    expect(resolveSourceChannelGroups(six as never)).toEqual([{ stream: 0, map: { format: "5.1", sources: [0, 1, 2, 3, 4, 5] } }]);
    expect(isMultichannelSource(six as never)).toBe(false);
    const shape = sourceAudioShape(six as never);
    expect(buildSourceGroups("mono", shape)).toHaveLength(6);
    expect(buildSourceGroups("stereo", shape).map((g) => g.map.sources)).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(matchSourceLayoutPreset(six as never)).toBe("file");
    const stereoSix = { ...six, channelLayout: buildSourceGroups("stereo", shape) };
    expect(matchSourceLayoutPreset(stereoSix as never)).toBe("stereo");
    expect(flattenedSourceChannels({}, six as never).sources).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("8ch with 5.1 groups = 5.1 + 2 mono; 7ch 'stereo' leaves odd mono", () => {
    const g = buildSourceGroups("5.1", sourceAudioShape(media("e", 8) as never));
    expect(g.map((x) => x.map.format)).toEqual(["5.1", "mono", "mono"]);
    const s = buildSourceGroups("stereo", sourceAudioShape(media("s", 7) as never));
    expect(s.map((x) => x.map.format)).toEqual(["stereo", "stereo", "stereo", "mono"]);
  });

  it("6-ch source with stereo pairs inserts 3 linked clips; undo exact", () => {
    const shape = sourceAudioShape(six as never);
    const m = { ...six, channelLayout: buildSourceGroups("stereo", shape) };
    const base = mk([m], [aTrack("a1"), aTrack("a2"), aTrack("a3")]);
    const groups = resolveSourceChannelGroups(m as never);
    const { plan } = planSourceEdit(base, {
      mode: "overwrite", media: m as never, trackId: "a1", clipId: "s0", operationId: "op", playhead: 2,
      audioChannels: groups.map((group, channel) => ({ trackId: `a${channel + 1}`, clipId: `s${channel}`, channel, group })),
    });
    validateTimelineToolEdits(base, plan.edits);
    const next = applyTimelineToolEdits(base, plan.edits);
    expect(next.timeline.tracks.map((t) => t.clips.map((c) => c.channelMap?.sources))).toEqual([[[0, 1]], [[2, 3]], [[4, 5]]]);
    const back = invertTimelineToolEdits(plan.edits);
    validateTimelineToolEdits(next, back);
    expect(applyTimelineToolEdits(next, back).timeline.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });

  it("mixed batch (5.1, 8ch, stereo, 2x2 stream) in one undo step with undo/redo", async () => {
    const items = [media("six", 6), media("eight", 8), media("st", 2), media("two", 2, 2)];
    const project = mk(items);
    const history = new ActionHistory();
    const ex = new ActionExecutor(history);
    const pre = (id: string, p: SourceLayoutPreset) => buildSourceGroups(p, sourceAudioShape(items.find((i) => i.id === id) as never));
    const r = await ex.execute({ type: "media/organize", id: "o", timestamp: 2, params: { label: "Audio channels", itemPatches: {
      six: { channelLayout: pre("six", "mono") }, eight: { channelLayout: pre("eight", "5.1") }, st: { channelLayout: pre("st", "mono") }, two: { channelLayout: pre("two", "stereo") },
    } } }, project);
    expect(r.success, JSON.stringify(r.error)).toBe(true);
    const counts = () => project.mediaLibrary.items.map((i) => resolveSourceChannelGroups(i as never).length);
    expect(counts()).toEqual([6, 3, 2, 2]);
    expect(history.getUndoStackSize()).toBe(1);
    await ex.undo(project);
    expect(counts()).toEqual([1, 8, 1, 2]);
    expect(project.mediaLibrary.items.every((i) => !("channelLayout" in (i as object)))).toBe(true);
    await ex.redo(project);
    expect(counts()).toEqual([6, 3, 2, 2]);
    await ex.undo(project); await ex.redo(project); await ex.undo(project);
    expect(counts()).toEqual([1, 8, 1, 2]);
  });
});
