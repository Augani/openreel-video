import type {
  MulticamEditDecisionList,
  MulticamEditPolicy,
} from "../multicam/automatic-edit";
import type { Clip, Track } from "../types/timeline";
import type { ProjectSettings } from "../types/project";
import type { MulticamManifest } from "../multicam/manifest";
import { applyMulticamDirectives } from "../multicam/shot-planner";
import type { MulticamShotPlan } from "../multicam/shot-planner";
import type { MulticamShotPolicy } from "../multicam/shot-planner";

export interface CameraAngle {
  id: string;
  name: string;
  clipId: string;
  trackId: string;
  offset: number;
  color: string;
  isActive: boolean;
  driftSecondsPerSecond?: number;
}

export interface MultiCamGroup {
  id: string;
  name: string;
  angles: CameraAngle[];
  activeAngleId: string;
  syncPoint: number;
  duration: number;
  createdAt: number;
  switches?: AngleSwitch[];
  outputTrackId?: string;
  outputTrackIds?: string[];
  automaticEdit?: MulticamAutomaticEditMetadata;
  manifest?: MulticamManifest;
  analysisArtifactId?: string;
  shotPlan?: MulticamShotPlan;
  editPolicy?: MulticamShotPolicy;
  annotations?: MulticamSegmentAnnotation[];
}

export interface MulticamSegmentAnnotation {
  id: string;
  startMs: number;
  endMs: number;
  note: string;
  createdAt: number;
}

export interface AngleSwitch {
  id: string;
  groupId: string;
  angleId: string;
  time: number;
  reason?: string;
  confidence?: number;
  reviewStatus?: "pending" | "accepted";
}

export interface MulticamAutomaticEditMetadata {
  generatedAt: number;
  activityWindowMs: number;
  policy: MulticamEditPolicy;
}

export interface MulticamSequenceClip {
  angleId: string;
  reason?: string;
  confidence?: number;
  clip: Clip;
}

export interface SyncResult {
  offset: number;
  confidence: number;
  method: "audio" | "timecode" | "manual";
}

const ANGLE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

function cloneGroup(group: MultiCamGroup): MultiCamGroup {
  return {
    ...group,
    angles: group.angles.map((angle) => ({ ...angle })),
    switches: (group.switches ?? []).map((switchItem) => ({ ...switchItem })),
    automaticEdit: group.automaticEdit
      ? {
          ...group.automaticEdit,
          policy: { ...group.automaticEdit.policy },
        }
      : undefined,
    manifest: group.manifest ? structuredClone(group.manifest) : undefined,
    shotPlan: group.shotPlan ? structuredClone(group.shotPlan) : undefined,
    editPolicy: group.editPolicy ? structuredClone(group.editPolicy) : undefined,
    annotations: group.annotations ? structuredClone(group.annotations) : undefined,
  };
}

export class MultiCamEngine {
  private groups: Map<string, MultiCamGroup> = new Map();

  constructor() {}

  createGroup(name: string, clipIds: string[]): MultiCamGroup {
    const id = `multicam_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const angles: CameraAngle[] = clipIds.map((clipId, index) => ({
      id: `angle_${index + 1}`,
      name: `Angle ${index + 1}`,
      clipId,
      trackId: "",
      offset: 0,
      color: ANGLE_COLORS[index % ANGLE_COLORS.length],
      isActive: index === 0,
    }));

    const group: MultiCamGroup = {
      id,
      name,
      angles,
      activeAngleId: angles[0]?.id || "",
      syncPoint: 0,
      duration: 0,
      createdAt: Date.now(),
      switches: [],
    };

    this.groups.set(id, group);

    return group;
  }

  getGroup(groupId: string): MultiCamGroup | undefined {
    return this.groups.get(groupId);
  }

  getAllGroups(): MultiCamGroup[] {
    return Array.from(this.groups.values(), cloneGroup);
  }

  loadGroups(groups: MultiCamGroup[]): void {
    this.groups.clear();
    for (const group of groups) {
      const normalized = cloneGroup(group);
      this.groups.set(group.id, normalized);
    }
  }

  deleteGroup(groupId: string): boolean {
    return this.groups.delete(groupId);
  }

  addAngle(groupId: string, clipId: string, name?: string): CameraAngle | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const index = group.angles.length;
    const angle: CameraAngle = {
      id: `angle_${Date.now()}`,
      name: name || `Angle ${index + 1}`,
      clipId,
      trackId: "",
      offset: 0,
      color: ANGLE_COLORS[index % ANGLE_COLORS.length],
      isActive: false,
    };

    group.angles.push(angle);
    return angle;
  }

  removeAngle(groupId: string, angleId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const index = group.angles.findIndex((a) => a.id === angleId);
    if (index === -1) return false;

    group.angles.splice(index, 1);
    group.switches = (group.switches ?? []).filter(
      (switchItem) => switchItem.angleId !== angleId,
    );

    if (group.activeAngleId === angleId && group.angles.length > 0) {
      group.activeAngleId = group.angles[0].id;
      group.angles[0].isActive = true;
    }

    return true;
  }

  setActiveAngle(groupId: string, angleId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const angle = group.angles.find((a) => a.id === angleId);
    if (!angle) return false;

    group.angles.forEach((a) => {
      a.isActive = a.id === angleId;
    });
    group.activeAngleId = angleId;

    return true;
  }

  getActiveAngle(groupId: string): CameraAngle | null {
    const group = this.groups.get(groupId);
    if (!group) return null;
    return group.angles.find((a) => a.id === group.activeAngleId) || null;
  }

  addSwitch(
    groupId: string,
    angleId: string,
    time: number,
    details: Pick<AngleSwitch, "reason" | "confidence"> = {},
  ): AngleSwitch | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const angle = group.angles.find((a) => a.id === angleId);
    if (!angle) return null;

    const switchItem: AngleSwitch = {
      id: `switch_${Date.now()}`,
      groupId,
      angleId,
      time,
      ...details,
    };

    const switches = group.switches ?? [];
    switches.push(switchItem);
    switches.sort((a, b) => a.time - b.time);
    group.switches = switches;

    return switchItem;
  }

  /** Insert or replace a camera cut without changing earlier or later shots. */
  cutToAngle(groupId: string, angleId: string, time: number): boolean {
    const group = this.groups.get(groupId);
    const angle = group?.angles.find((entry) => entry.id === angleId);
    if (!group || !angle || !Number.isFinite(time) || time < 0 || time >= group.duration) return false;
    if (group.shotPlan && group.manifest) {
      const camera = group.manifest.cameras.find((entry) => entry.angleId === angleId || entry.clipId === angle.clipId);
      const shot = group.shotPlan.shots.find((entry) => entry.startMs <= time * 1000 && entry.endMs > time * 1000);
      if (!camera || !shot) return false;
      group.shotPlan = applyMulticamDirectives(group.shotPlan, group.manifest, [{
        id: `manual-${crypto.randomUUID()}`,
        startMs: time * 1000,
        endMs: shot.endMs,
        cameraId: camera.id,
      }]);
      group.switches = group.shotPlan.shots.map((entry) => ({
        id: `switch-${crypto.randomUUID()}`, groupId,
        angleId: group.angles.find((candidate) => {
          const camera = group.manifest!.cameras.find((item) => item.id === entry.layout.panels[0]?.cameraId);
          return candidate.id === camera?.angleId || candidate.clipId === camera?.clipId;
        })?.id ?? angleId,
        time: entry.startMs / 1000, reason: entry.reason, confidence: entry.confidence,
      }));
    } else {
      const switches = group.switches ?? [];
      if (!switches.some((entry) => entry.time === 0)) {
        switches.unshift({ id: `switch-${crypto.randomUUID()}`, groupId,
          angleId: group.activeAngleId, time: 0, reason: "manual" });
      }
      group.switches = switches.filter((entry) => Math.abs(entry.time - time) > 0.000001);
      group.switches.push({ id: `switch-${crypto.randomUUID()}`, groupId, angleId, time, reason: "manual" });
      group.switches.sort((a, b) => a.time - b.time);
    }
    this.setActiveAngle(groupId, group.switches[0]?.angleId ?? angleId);
    return true;
  }

  removeSwitch(groupId: string, switchId: string): boolean {
    const group = this.groups.get(groupId);
    const switches = group?.switches;
    if (!switches) return false;

    const index = switches.findIndex((s) => s.id === switchId);
    if (index === -1) return false;

    const removed = switches[index]!;
    switches.splice(index, 1);
    const plan = group?.shotPlan;
    if (plan) {
      const shotIndex = plan.shots.findIndex(
        (shot) => Math.abs(shot.startMs / 1_000 - removed.time) < 0.001,
      );
      if (shotIndex > 0) {
        plan.shots[shotIndex - 1]!.endMs = plan.shots[shotIndex]!.endMs;
        plan.shots.splice(shotIndex, 1);
        const previous = plan.shots[shotIndex - 1];
        const next = plan.shots[shotIndex];
        if (
          previous &&
          next &&
          JSON.stringify(previous.layout) === JSON.stringify(next.layout)
        ) {
          previous.endMs = next.endMs;
          plan.shots.splice(shotIndex, 1);
        }
      }
    }
    return true;
  }

  getSwitches(groupId: string): AngleSwitch[] {
    return this.groups.get(groupId)?.switches ?? [];
  }

  replaceSwitches(
    groupId: string,
    switches: readonly Omit<AngleSwitch, "id" | "groupId">[],
  ): AngleSwitch[] {
    const group = this.groups.get(groupId);
    if (!group) return [];
    const angleIds = new Set(group.angles.map((angle) => angle.id));
    group.switches = switches
      .filter(
        (switchItem) =>
          angleIds.has(switchItem.angleId) &&
          Number.isFinite(switchItem.time) &&
          switchItem.time >= 0 &&
          switchItem.time < group.duration,
      )
      .map((switchItem, index) => ({
        ...switchItem,
        id: `switch_${group.id}_${Math.round(switchItem.time * 1_000)}_${index}`,
        groupId: group.id,
      }))
      .sort((a, b) => a.time - b.time);
    return group.switches;
  }

  applyAutomaticEdit(
    groupId: string,
    edit: MulticamEditDecisionList,
    policy: MulticamEditPolicy,
    activityWindowMs: number,
  ): AngleSwitch[] {
    const group = this.groups.get(groupId);
    if (!group) return [];
    group.duration = edit.duration;
    group.automaticEdit = {
      generatedAt: Date.now(),
      activityWindowMs,
      policy: { ...policy },
    };
    const switches = this.replaceSwitches(
      groupId,
      edit.segments.map((segment) => ({
        angleId: segment.angleId,
        time: segment.startTime,
        reason: segment.reason,
        confidence: segment.confidence,
        reviewStatus: segment.startTime === 0 ? "accepted" : "pending",
      })),
    );
    if (switches[0]) {
      this.setActiveAngle(groupId, switches[0].angleId);
    }
    return switches;
  }

  acceptSwitch(groupId: string, switchId: string): boolean {
    const switchItem = this.groups
      .get(groupId)
      ?.switches?.find((entry) => entry.id === switchId);
    if (!switchItem) return false;
    switchItem.reviewStatus = "accepted";
    return true;
  }

  nudgeSwitch(
    groupId: string,
    switchId: string,
    deltaSeconds: number,
    minimumShotSeconds = 0.1,
  ): boolean {
    const switches = this.groups.get(groupId)?.switches;
    if (!switches) return false;
    const index = switches.findIndex((entry) => entry.id === switchId);
    if (index <= 0) return false;
    const previous = switches[index - 1]!;
    const current = switches[index]!;
    const previousTime = current.time;
    const next = switches[index + 1];
    current.time = Math.min(
      (next?.time ?? this.groups.get(groupId)?.duration ?? current.time) -
        minimumShotSeconds,
      Math.max(previous.time + minimumShotSeconds, current.time + deltaSeconds),
    );
    current.reviewStatus = "pending";
    const plan = this.groups.get(groupId)?.shotPlan;
    if (plan) {
      const shotIndex = plan.shots.findIndex(
        (shot) => Math.abs(shot.startMs / 1_000 - previousTime) < 0.001,
      );
      if (shotIndex > 0) {
        plan.shots[shotIndex - 1]!.endMs = current.time * 1_000;
        plan.shots[shotIndex]!.startMs = current.time * 1_000;
      }
    }
    switches.sort((left, right) => left.time - right.time);
    return true;
  }

  setOutputTrack(groupId: string, trackId: string | undefined): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    group.outputTrackId = trackId;
    group.outputTrackIds = trackId ? [trackId] : [];
    return true;
  }

  setOutputTracks(groupId: string, trackIds: readonly string[]): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    group.outputTrackIds = [...trackIds];
    group.outputTrackId = trackIds[0];
    return true;
  }

  getAngleAtTime(groupId: string, time: number): CameraAngle | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const switches = group.switches ?? [];
    let activeAngleId = group.activeAngleId || group.angles[0]?.id;

    for (const sw of switches) {
      if (sw.time <= time) {
        activeAngleId = sw.angleId;
      } else {
        break;
      }
    }

    return group.angles.find((a) => a.id === activeAngleId) || null;
  }

  setAngleOffset(groupId: string, angleId: string, offset: number): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const angle = group.angles.find((a) => a.id === angleId);
    if (!angle) return false;

    angle.offset = offset;
    return true;
  }

  renameAngle(groupId: string, angleId: string, name: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    const angle = group.angles.find((a) => a.id === angleId);
    if (!angle) return false;

    angle.name = name;
    return true;
  }

  async syncByAudio(
    groupId: string,
    referenceAngleId: string,
    audioBuffers: Map<string, AudioBuffer>,
  ): Promise<Map<string, SyncResult>> {
    const group = this.groups.get(groupId);
    if (!group) return new Map();

    const results = new Map<string, SyncResult>();
    const referenceBuffer = audioBuffers.get(referenceAngleId);

    if (!referenceBuffer) {
      return results;
    }

    for (const angle of group.angles) {
      if (angle.id === referenceAngleId) {
        results.set(angle.id, { offset: 0, confidence: 1, method: "audio" });
        continue;
      }

      const targetBuffer = audioBuffers.get(angle.id);
      if (!targetBuffer) {
        results.set(angle.id, { offset: 0, confidence: 0, method: "manual" });
        continue;
      }

      const offset = await this.findAudioOffset(referenceBuffer, targetBuffer);
      results.set(angle.id, offset);
      angle.offset = offset.offset;
    }

    return results;
  }

  private async findAudioOffset(
    reference: AudioBuffer,
    target: AudioBuffer,
  ): Promise<SyncResult> {
    const refData = reference.getChannelData(0);
    const targetData = target.getChannelData(0);

    const sampleRate = reference.sampleRate;
    const windowSize = Math.min(
      sampleRate * 5,
      refData.length,
      targetData.length,
    );
    const maxOffset = Math.min(sampleRate * 30, targetData.length - windowSize);

    let bestOffset = 0;
    let bestCorrelation = -Infinity;

    const step = Math.max(1, Math.floor(sampleRate / 100));

    for (let offset = -maxOffset; offset <= maxOffset; offset += step) {
      let correlation = 0;
      let count = 0;

      for (let i = 0; i < windowSize; i += step) {
        const refIdx = i;
        const targetIdx = i + offset;

        if (targetIdx >= 0 && targetIdx < targetData.length) {
          correlation += refData[refIdx] * targetData[targetIdx];
          count++;
        }
      }

      if (count > 0) {
        correlation /= count;
        if (correlation > bestCorrelation) {
          bestCorrelation = correlation;
          bestOffset = offset;
        }
      }
    }

    const offsetSeconds = bestOffset / sampleRate;
    const confidence = Math.max(0, Math.min(1, (bestCorrelation + 1) / 2));

    return {
      offset: offsetSeconds,
      confidence,
      method: "audio",
    };
  }

  setSyncPoint(groupId: string, time: number): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    group.syncPoint = time;
    return true;
  }

  clearGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (group) {
      group.angles = [];
      group.activeAngleId = "";
      group.switches = [];
      group.outputTrackId = undefined;
      group.automaticEdit = undefined;
    }
  }

  clearAll(): void {
    this.groups.clear();
  }

  exportGroupAsSequence(
    groupId: string,
  ): { clipId: string; startTime: number; endTime: number }[] {
    const group = this.groups.get(groupId);
    if (!group) return [];

    const switches = group.switches ?? [];
    const sequence: { clipId: string; startTime: number; endTime: number }[] =
      [];

    if (switches.length === 0 && group.angles.length > 0) {
      const activeAngle = group.angles.find(
        (a) => a.id === group.activeAngleId,
      );
      if (activeAngle) {
        sequence.push({
          clipId: activeAngle.clipId,
          startTime: 0,
          endTime: group.duration,
        });
      }
      return sequence;
    }

    let currentAngleId = group.activeAngleId || group.angles[0]?.id;
    let currentStartTime = 0;

    for (let i = 0; i < switches.length; i++) {
      const sw = switches[i];
      const angle = group.angles.find((a) => a.id === currentAngleId);

      if (angle && sw.time > currentStartTime) {
        sequence.push({
          clipId: angle.clipId,
          startTime: currentStartTime,
          endTime: sw.time,
        });
      }

      currentAngleId = sw.angleId;
      currentStartTime = sw.time;
    }

    const lastAngle = group.angles.find((a) => a.id === currentAngleId);
    if (lastAngle && currentStartTime < group.duration) {
      sequence.push({
        clipId: lastAngle.clipId,
        startTime: currentStartTime,
        endTime: group.duration,
      });
    }

    return sequence;
  }

  buildSequenceClips(
    groupId: string,
    outputTrackId: string,
    sourceClips: ReadonlyMap<string, Clip>,
  ): MulticamSequenceClip[] {
    const group = this.groups.get(groupId);
    if (!group) return [];

    const switchByTime = new Map(
      (group.switches ?? []).map((switchItem) => [switchItem.time, switchItem]),
    );
    return this.exportGroupAsSequence(groupId).flatMap((segment) => {
      const angle = group.angles.find((item) => item.clipId === segment.clipId);
      const source = sourceClips.get(segment.clipId);
      if (!angle || !source) return [];

      const playbackRate = Math.max(0.01, source.speed ?? 1);
      const requestedInPoint =
        source.inPoint +
        segment.startTime * playbackRate +
        angle.offset +
        (angle.driftSecondsPerSecond ?? 0) * segment.startTime;
      const inPoint = Math.max(source.inPoint, requestedInPoint);
      const skippedTimeline = (inPoint - requestedInPoint) / playbackRate;
      const timelineStart = segment.startTime + skippedTimeline;
      const requestedDuration = segment.endTime - timelineStart;
      const availableDuration = Math.max(
        0,
        (source.outPoint - inPoint) / playbackRate,
      );
      const duration = Math.min(requestedDuration, availableDuration);
      if (duration <= 0) return [];

      const switchItem = switchByTime.get(segment.startTime);
      const multicamMetadata = {
        groupId,
        angleId: angle.id,
        reason: switchItem?.reason,
        confidence: switchItem?.confidence,
      };
      const clip: Clip = {
        ...structuredClone(source),
        id: `${source.id}-multicam-${Math.round(timelineStart * 1_000)}`,
        trackId: outputTrackId,
        startTime: group.syncPoint + timelineStart,
        duration,
        inPoint,
        outPoint: inPoint + duration * playbackRate,
        metadata: {
          ...source.metadata,
          multicam: multicamMetadata,
        },
      };
      return [{
        angleId: angle.id,
        reason: switchItem?.reason,
        confidence: switchItem?.confidence,
        clip,
      }];
    });
  }

  buildShotPlanTracks(
    groupId: string,
    outputTrackId: string,
    sourceClips: ReadonlyMap<string, Clip>,
    settings: Pick<ProjectSettings, "width" | "height">,
  ): Track[] {
    const group = this.groups.get(groupId);
    const plan = group?.shotPlan;
    const manifest = group?.manifest;
    if (!group || !plan || !manifest) return [];
    const panelCount = plan.shots.reduce(
      (maximum, shot) => Math.max(maximum, shot.layout.panels.length),
      1,
    );
    return Array.from({ length: panelCount }, (_, panelIndex) => {
      const trackId = panelIndex === 0
        ? outputTrackId
        : `${outputTrackId}-panel-${panelIndex + 1}`;
      const clips = plan.shots.flatMap((shot, shotIndex) => {
        const panel = shot.layout.panels[panelIndex];
        if (!panel) return [];
        const camera = manifest.cameras.find((entry) => entry.id === panel.cameraId);
        const angle = group.angles.find(
          (entry) => entry.id === panel.cameraId || entry.clipId === camera?.clipId,
        );
        const source = angle ? sourceClips.get(angle.clipId) : undefined;
        if (!angle || !source) return [];
        const segmentStart = shot.startMs / 1_000;
        const segmentEnd = shot.endMs / 1_000;
        const playbackRate = Math.max(0.01, source.speed ?? 1);
        const requestedInPoint =
          source.inPoint +
          segmentStart * playbackRate +
          angle.offset +
          (angle.driftSecondsPerSecond ?? 0) * segmentStart;
        const inPoint = Math.max(source.inPoint, requestedInPoint);
        const skippedTimeline = (inPoint - requestedInPoint) / playbackRate;
        const timelineStart = segmentStart + skippedTimeline;
        const availableDuration = Math.max(
          0,
          (source.outPoint - inPoint) / playbackRate,
        );
        const duration = Math.min(segmentEnd - timelineStart, availableDuration);
        if (duration <= 0) return [];
        const targetPosition = {
          x:
            source.transform.position.x +
            (panel.rect.x + panel.rect.width / 2 - 0.5) * settings.width,
          y:
            source.transform.position.y +
            (panel.rect.y + panel.rect.height / 2 - 0.5) * settings.height,
        };
        const targetScale = {
          x: source.transform.scale.x * panel.rect.width,
          y: source.transform.scale.y * panel.rect.height,
        };
        const previousPanel = plan.shots[shotIndex - 1]?.layout.panels.find(
          (entry) => entry.cameraId === panel.cameraId,
        );
        const morphDuration = Math.min(
          duration,
          shot.transitionIn.type === "layout-morph"
            ? shot.transitionIn.durationMs / 1_000
            : 0,
        );
        const morphKeyframes = previousPanel && morphDuration > 0
          ? [
              {
                id: `${groupId}-${shot.startMs}-${panelIndex}-position-start`,
                time: 0,
                property: "transform.position",
                value: {
                  x: source.transform.position.x +
                    (previousPanel.rect.x + previousPanel.rect.width / 2 - 0.5) * settings.width,
                  y: source.transform.position.y +
                    (previousPanel.rect.y + previousPanel.rect.height / 2 - 0.5) * settings.height,
                },
                easing: "ease-in-out" as const,
              },
              {
                id: `${groupId}-${shot.startMs}-${panelIndex}-position-end`,
                time: morphDuration,
                property: "transform.position",
                value: targetPosition,
                easing: "ease-in-out" as const,
              },
              {
                id: `${groupId}-${shot.startMs}-${panelIndex}-scale-start`,
                time: 0,
                property: "transform.scale",
                value: {
                  x: source.transform.scale.x * previousPanel.rect.width,
                  y: source.transform.scale.y * previousPanel.rect.height,
                },
                easing: "ease-in-out" as const,
              },
              {
                id: `${groupId}-${shot.startMs}-${panelIndex}-scale-end`,
                time: morphDuration,
                property: "transform.scale",
                value: targetScale,
                easing: "ease-in-out" as const,
              },
            ]
          : [];
        const clip: Clip = {
          ...structuredClone(source),
          id: `${source.id}-multicam-${shot.startMs}-panel-${panelIndex + 1}`,
          trackId,
          startTime: group.syncPoint + timelineStart,
          duration,
          inPoint,
          outPoint: inPoint + duration * playbackRate,
          volume: panelIndex === 0 ? source.volume : 0,
          transform: {
            ...structuredClone(source.transform),
            position: targetPosition,
            scale: targetScale,
            fitMode: "cover",
            crop: panel.crop,
          },
          keyframes: [...structuredClone(source.keyframes), ...morphKeyframes],
          metadata: {
            ...source.metadata,
            multicam: {
              groupId,
              angleId: angle.id,
              panelIndex,
              layout: shot.layout.template,
              rect: panel.rect,
              reason: shot.reason,
              confidence: shot.confidence,
            },
          },
        };
        return [clip];
      });
      return {
        id: trackId,
        type: "video",
        name: panelIndex === 0
          ? `${group.name} Auto Edit`
          : `${group.name} Panel ${panelIndex + 1}`,
        clips,
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        groupId: `multicam-layout-${group.id}`,
      };
    });
  }
}

export const multicamEngine = new MultiCamEngine();
