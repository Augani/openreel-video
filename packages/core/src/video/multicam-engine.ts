export interface CameraAngle {
  id: string;
  name: string;
  clipId: string;
  trackId: string;
  offset: number;
  color: string;
  isActive: boolean;
}

export interface MultiCamGroup {
  id: string;
  name: string;
  angles: CameraAngle[];
  activeAngleId: string;
  syncPoint: number;
  duration: number;
  createdAt: number;
}

export interface AngleSwitch {
  id: string;
  groupId: string;
  angleId: string;
  time: number;
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

export class MultiCamEngine {
  private groups: Map<string, MultiCamGroup> = new Map();
  private switches: Map<string, AngleSwitch[]> = new Map();

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
    };

    this.groups.set(id, group);
    this.switches.set(id, []);

    return group;
  }

  getGroup(groupId: string): MultiCamGroup | undefined {
    return this.groups.get(groupId);
  }

  getAllGroups(): MultiCamGroup[] {
    return Array.from(this.groups.values());
  }

  loadGroups(groups: MultiCamGroup[]): void {
    this.groups.clear();
    for (const group of groups) {
      this.groups.set(group.id, group);
    }
  }

  deleteGroup(groupId: string): boolean {
    this.switches.delete(groupId);
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
    };

    const switches = this.switches.get(groupId) || [];
    switches.push(switchItem);
    switches.sort((a, b) => a.time - b.time);
    this.switches.set(groupId, switches);

    return switchItem;
  }

  removeSwitch(groupId: string, switchId: string): boolean {
    const switches = this.switches.get(groupId);
    if (!switches) return false;

    const index = switches.findIndex((s) => s.id === switchId);
    if (index === -1) return false;

    switches.splice(index, 1);
    return true;
  }

  getSwitches(groupId: string): AngleSwitch[] {
    return this.switches.get(groupId) || [];
  }

  getAngleAtTime(groupId: string, time: number): CameraAngle | null {
    const group = this.groups.get(groupId);
    if (!group) return null;

    const switches = this.switches.get(groupId) || [];
    let activeAngleId = group.angles[0]?.id;

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
    }
    this.switches.set(groupId, []);
  }

  clearAll(): void {
    this.groups.clear();
    this.switches.clear();
  }

  exportGroupAsSequence(
    groupId: string,
  ): { clipId: string; startTime: number; endTime: number }[] {
    const group = this.groups.get(groupId);
    if (!group) return [];

    const switches = this.switches.get(groupId) || [];
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

    let currentAngleId = group.angles[0]?.id;
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
}

export const multicamEngine = new MultiCamEngine();
