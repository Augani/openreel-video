import type {
  MulticamActivityMap,
  MulticamActivityPoint,
} from "./automatic-edit";
import type {
  MulticamManifest,
  MulticamManifestCamera,
  MulticamManifestParticipant,
} from "./manifest";

export type MulticamDecisionStrategy =
  | "hold"
  | "winner"
  | "priority"
  | "wide"
  | "composite"
  | "progressive";

type MulticamLayoutTemplate =
  | "solo"
  | "split2"
  | "split3"
  | "pip"
  | "wide";

interface MulticamPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MulticamPanel {
  cameraId: string;
  subject: string;
  rect: MulticamPanelRect;
  crop?: MulticamPanelRect;
}

export interface MulticamShotLayout {
  template: MulticamLayoutTemplate;
  panels: MulticamPanel[];
}

export interface MulticamShotTransition {
  type: "cut" | "dissolve" | "layout-morph";
  durationMs: number;
}

export type MulticamShotReason =
  | "speaker"
  | "backchannel-hold"
  | "turn-collision-winner"
  | "successful-interruption"
  | "sustained-overlap"
  | "group-reaction"
  | "silence-hold"
  | "reaction-shot"
  | "max-shot"
  | "layout-budget"
  | "directive";

export interface MulticamShot {
  startMs: number;
  endMs: number;
  layout: MulticamShotLayout;
  transitionIn: MulticamShotTransition;
  reason: MulticamShotReason;
  confidence: number;
}

export interface MulticamShotPlan {
  spec: "openreel-multicam-edit/v1";
  durationMs: number;
  shots: MulticamShot[];
}

export interface MulticamShotPolicy {
  strategy: MulticamDecisionStrategy;
  escalateTo: Exclude<MulticamDecisionStrategy, "hold">;
  priorityParticipantIds: string[];
  commitMs: number;
  layoutEnterMs: number;
  layoutExitMs: number;
  minLayoutLifeMs: number;
  maxLayoutChangesPerMinute: number;
}

export const DEFAULT_MULTICAM_SHOT_POLICY: MulticamShotPolicy = {
  strategy: "hold",
  escalateTo: "wide",
  priorityParticipantIds: [],
  commitMs: 300,
  layoutEnterMs: 350,
  layoutExitMs: 1_400,
  minLayoutLifeMs: 1_200,
  maxLayoutChangesPerMinute: 6,
};

interface ClassifiedSpan {
  startMs: number;
  endMs: number;
  participantIds: string[];
  scores: Record<string, number>;
  speech: Record<string, number>;
  kind:
    | "speaker"
    | "backchannel"
    | "turn-collision"
    | "interruption"
    | "sustained-overlap"
    | "group-reaction"
    | "silence";
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

function seatOrder(participant: MulticamManifestParticipant): number {
  if (typeof participant.seat === "number") return participant.seat;
  return { left: 0, center: 1, right: 2 }[participant.seat];
}

function participantForActivityId(
  manifest: MulticamManifest,
  activityId: string,
): string | undefined {
  const participant = manifest.participants.find(
    (entry) => entry.id === activityId || entry.audio === activityId,
  );
  if (participant) return participant.id;
  const camera = manifest.cameras.find(
    (entry) => entry.id === activityId || entry.angleId === activityId,
  );
  return camera && camera.subject !== "all" && !camera.subject.includes("+")
    ? camera.subject
    : undefined;
}

function averageRecord(
  points: readonly MulticamActivityPoint[],
  key: "scores" | "speechProbabilities",
  manifest: MulticamManifest,
): Record<string, number> {
  const totals: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const point of points) {
    const record = point[key] ?? {};
    for (const [activityId, value] of Object.entries(record)) {
      const participantId = participantForActivityId(manifest, activityId);
      if (!participantId) continue;
      totals[participantId] = (totals[participantId] ?? 0) + value;
      counts[participantId] = (counts[participantId] ?? 0) + 1;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([id, value]) => [id, value / (counts[id] ?? 1)]),
  );
}

function classifyActivity(
  activity: MulticamActivityMap,
  manifest: MulticamManifest,
): ClassifiedSpan[] {
  const raw: Array<Omit<ClassifiedSpan, "kind"> & { points: MulticamActivityPoint[] }> = [];
  for (const point of activity.points) {
    const participantIds = [...new Set(
      point.activeAngleIds
        .map((id) => participantForActivityId(manifest, id))
        .filter((id): id is string => Boolean(id)),
    )].sort();
    const previous = raw[raw.length - 1];
    if (
      previous &&
      previous.participantIds.join("|") === participantIds.join("|") &&
      Math.abs(previous.endMs - point.startTime * 1_000) < 1
    ) {
      previous.endMs = point.endTime * 1_000;
      previous.points.push(point);
    } else {
      raw.push({
        startMs: point.startTime * 1_000,
        endMs: point.endTime * 1_000,
        participantIds,
        scores: {},
        speech: {},
        points: [point],
      });
    }
  }

  return raw.map((entry, index) => {
    const scores = averageRecord(entry.points, "scores", manifest);
    const speech = averageRecord(entry.points, "speechProbabilities", manifest);
    const duration = entry.endMs - entry.startMs;
    const previous = raw[index - 1];
    const next = raw[index + 1];
    let kind: ClassifiedSpan["kind"] = "speaker";
    if (entry.participantIds.length === 0) {
      const nonSpeechEnergy = Object.values(scores).some((value) => value >= 0.5);
      const lowSpeech = Object.values(speech).every((value) => value < 0.5);
      kind = nonSpeechEnergy && lowSpeech ? "group-reaction" : "silence";
    } else if (entry.participantIds.length > 1) {
      const orderedScores = entry.participantIds
        .map((id) => scores[id] ?? 0)
        .sort((left, right) => right - left);
      if (duration < 700 && (orderedScores[1] ?? 0) < (orderedScores[0] ?? 0) * 0.65) {
        kind = "backchannel";
      } else if (duration >= 2_000) {
        kind = "sustained-overlap";
      } else {
        const previousSolo = previous?.participantIds.length === 1
          ? previous.participantIds[0]
          : undefined;
        const nextSolo = next?.participantIds.length === 1
          ? next.participantIds[0]
          : undefined;
        kind = previousSolo && nextSolo && previousSolo !== nextSolo
          ? "interruption"
          : "turn-collision";
      }
    }
    return {
      startMs: entry.startMs,
      endMs: entry.endMs,
      participantIds: entry.participantIds,
      scores,
      speech,
      kind,
    };
  });
}

function cameraForSubject(
  manifest: MulticamManifest,
  subject: string,
): MulticamManifestCamera | undefined {
  return (
    manifest.cameras.find(
      (camera) => camera.subject === subject && camera.type === "closeup",
    ) ?? manifest.cameras.find((camera) => camera.subject === subject)
  );
}

function wideCamera(manifest: MulticamManifest): MulticamManifestCamera {
  return (
    manifest.cameras.find((camera) => camera.type === "wide") ??
    manifest.cameras[0]!
  );
}

function panelRects(count: number): MulticamPanelRect[] {
  if (count <= 1) return [{ x: 0, y: 0, width: 1, height: 1 }];
  return Array.from({ length: count }, (_, index) => ({
    x: index / count,
    y: 0,
    width: 1 / count,
    height: 1,
  }));
}

function layoutForParticipants(
  manifest: MulticamManifest,
  participantIds: readonly string[],
  strategy: MulticamDecisionStrategy,
): MulticamShotLayout {
  if (strategy === "wide" || participantIds.length === 0) {
    const camera = wideCamera(manifest);
    return {
      template: "wide",
      panels: [{ cameraId: camera.id, subject: camera.subject, rect: panelRects(1)[0]! }],
    };
  }
  const ordered = participantIds
    .map((id) => manifest.participants.find((participant) => participant.id === id))
    .filter((participant): participant is MulticamManifestParticipant => Boolean(participant))
    .sort((left, right) => seatOrder(left) - seatOrder(right));
  if (strategy === "progressive" && ordered.length > 1) {
    const base = cameraForSubject(manifest, ordered[0]!.id) ?? wideCamera(manifest);
    const pip = cameraForSubject(manifest, ordered[1]!.id) ?? wideCamera(manifest);
    return {
      template: "pip",
      panels: [
        { cameraId: base.id, subject: base.subject, rect: panelRects(1)[0]! },
        { cameraId: pip.id, subject: pip.subject, rect: { x: 0.68, y: 0.62, width: 0.28, height: 0.32 } },
      ],
    };
  }
  const selected = strategy === "composite" ? ordered.slice(0, 3) : ordered.slice(0, 1);
  const rects = panelRects(selected.length);
  return {
    template:
      selected.length === 1 ? "solo" : selected.length === 2 ? "split2" : "split3",
    panels: selected.map((participant, index) => {
      const camera = cameraForSubject(manifest, participant.id) ?? wideCamera(manifest);
      return {
        cameraId: camera.id,
        subject: participant.id,
        rect: rects[index]!,
      };
    }),
  };
}

function layoutKey(layout: MulticamShotLayout): string {
  return `${layout.template}:${layout.panels.map((panel) => panel.cameraId).join("+")}`;
}

function winner(
  span: ClassifiedSpan,
  policy: MulticamShotPolicy,
): string | undefined {
  if (policy.strategy === "priority") {
    const priority = policy.priorityParticipantIds.find((id) =>
      span.participantIds.includes(id),
    );
    if (priority) return priority;
  }
  return [...span.participantIds].sort(
    (left, right) =>
      (span.scores[right] ?? 0) - (span.scores[left] ?? 0) ||
      left.localeCompare(right),
  )[0];
}

function desiredShot(
  span: ClassifiedSpan,
  manifest: MulticamManifest,
  policy: MulticamShotPolicy,
  current?: MulticamShot,
): MulticamShot {
  let strategy = policy.strategy;
  let participantIds = span.participantIds;
  let reason: MulticamShotReason = "speaker";
  if (span.kind === "silence") {
    reason = "silence-hold";
    if (current) return { ...current, startMs: span.startMs, endMs: span.endMs, reason };
    strategy = "wide";
  } else if (span.kind === "group-reaction") {
    reason = "group-reaction";
    strategy = "wide";
  } else if (span.kind === "backchannel") {
    reason = "backchannel-hold";
    if (current) return { ...current, startMs: span.startMs, endMs: span.endMs, reason };
    participantIds = [winner(span, policy)!].filter(Boolean);
  } else if (span.kind === "sustained-overlap") {
    reason = "sustained-overlap";
    strategy = policy.escalateTo;
  } else if (span.kind === "interruption") {
    reason = "successful-interruption";
    participantIds = [winner(span, policy)!].filter(Boolean);
    strategy = strategy === "composite" || strategy === "progressive" ? strategy : "winner";
  } else if (span.kind === "turn-collision") {
    reason = "turn-collision-winner";
    if (strategy === "hold" && current) {
      return { ...current, startMs: span.startMs, endMs: span.endMs, reason };
    }
    if (strategy === "winner" || strategy === "priority" || strategy === "hold") {
      participantIds = [winner(span, policy)!].filter(Boolean);
    }
  } else {
    participantIds = [winner(span, policy)!].filter(Boolean);
    strategy = "winner";
  }
  const confidence = participantIds.length
    ? participantIds.reduce((sum, id) => sum + (span.scores[id] ?? 0), 0) /
      participantIds.length
    : 0.5;
  return {
    startMs: span.startMs,
    endMs: span.endMs,
    layout: layoutForParticipants(manifest, participantIds, strategy),
    transitionIn: { type: "cut", durationMs: 0 },
    reason,
    confidence: clamp(confidence, 0, 1),
  };
}

function mergeShots(shots: readonly MulticamShot[]): MulticamShot[] {
  const output: MulticamShot[] = [];
  for (const shot of shots) {
    const previous = output[output.length - 1];
    if (previous && layoutKey(previous.layout) === layoutKey(shot.layout)) {
      previous.endMs = shot.endMs;
      previous.confidence = Math.max(previous.confidence, shot.confidence);
      if (previous.reason === "silence-hold") previous.reason = shot.reason;
    } else {
      output.push(structuredClone(shot));
    }
  }
  return output;
}

function applyHysteresis(
  desired: readonly MulticamShot[],
  manifest: MulticamManifest,
  policy: MulticamShotPolicy,
): MulticamShot[] {
  const output: MulticamShot[] = [];
  for (const shot of desired) {
    const previous = output[output.length - 1];
    const duration = shot.endMs - shot.startMs;
    const leavingLayout = previous && previous.layout.template !== "solo";
    const required = leavingLayout ? policy.layoutExitMs : policy.layoutEnterMs;
    if (
      previous &&
      layoutKey(previous.layout) !== layoutKey(shot.layout) &&
      duration < Math.max(policy.commitMs, required)
    ) {
      previous.endMs = shot.endMs;
      continue;
    }
    const recentChanges = output.filter(
      (entry) => entry.startMs >= shot.startMs - 60_000,
    ).length - 1;
    let next = structuredClone(shot);
    if (
      previous &&
      layoutKey(previous.layout) !== layoutKey(next.layout) &&
      recentChanges >= policy.maxLayoutChangesPerMinute
    ) {
      next = {
        ...next,
        layout: layoutForParticipants(manifest, [], "wide"),
        reason: "layout-budget",
      };
    }
    if (previous && next.startMs - previous.startMs < policy.minLayoutLifeMs) {
      const boundary = previous.startMs + policy.minLayoutLifeMs;
      if (boundary >= next.endMs) {
        previous.endMs = next.endMs;
        continue;
      }
      previous.endMs = boundary;
      next.startMs = boundary;
    }
    if (previous && previous.layout.template !== next.layout.template) {
      next.transitionIn = { type: "layout-morph", durationMs: 200 };
    }
    output.push(next);
  }
  return mergeShots(output);
}

function addReactionShots(
  shots: readonly MulticamShot[],
  manifest: MulticamManifest,
): MulticamShot[] {
  const output: MulticamShot[] = [];
  const constraints = manifest.constraints;
  const reactionLength = Math.max(constraints.min_shot_ms, 1_200);
  for (const shot of shots) {
    const triggerAfter = Math.min(
      constraints.reaction_shot_after_ms,
      constraints.max_shot_ms,
    );
    let cursor = shot.startMs;
    while (shot.endMs - cursor > triggerAfter + reactionLength) {
      const reactionStart = cursor + triggerAfter;
      const reactionEnd = Math.min(shot.endMs, reactionStart + reactionLength);
      output.push({ ...structuredClone(shot), startMs: cursor, endMs: reactionStart });
      const subject = shot.layout.panels[0]?.subject;
      const alternate = manifest.participants.find(
        (participant) => participant.id !== subject,
      );
      const layout = shot.layout.template === "solo" && alternate
        ? layoutForParticipants(manifest, [alternate.id], "winner")
        : shot.layout.template === "wide" && manifest.participants[0]
          ? layoutForParticipants(manifest, [manifest.participants[0].id], "winner")
          : layoutForParticipants(manifest, [], "wide");
      output.push({
        ...structuredClone(shot),
        startMs: reactionStart,
        endMs: reactionEnd,
        layout,
        transitionIn: { type: "cut", durationMs: 0 },
        reason: constraints.max_shot_ms <= constraints.reaction_shot_after_ms
          ? "max-shot"
          : "reaction-shot",
        confidence: 0.5,
      });
      cursor = reactionEnd;
    }
    if (cursor < shot.endMs) output.push({ ...structuredClone(shot), startMs: cursor });
  }
  return output;
}

function applyCutLead(
  shots: readonly MulticamShot[],
  cutLeadMs: number,
  minimumShotMs: number,
): MulticamShot[] {
  const output = shots.map((shot) => structuredClone(shot));
  for (let index = 1; index < output.length; index++) {
    const previous = output[index - 1]!;
    const current = output[index]!;
    const boundary = Math.max(
      previous.startMs + minimumShotMs,
      current.startMs - Math.max(0, cutLeadMs),
    );
    if (boundary < current.endMs) {
      previous.endMs = boundary;
      current.startMs = boundary;
    }
  }
  return output;
}

/** Two-pass offline planner: first classifies overlap spans, then plans stable layouts. */
export function planMulticamShots(
  activity: MulticamActivityMap,
  manifest: MulticamManifest,
  overrides: Partial<MulticamShotPolicy> = {},
): MulticamShotPlan {
  const policy = {
    ...DEFAULT_MULTICAM_SHOT_POLICY,
    ...overrides,
    minLayoutLifeMs: Math.max(
      overrides.minLayoutLifeMs ?? DEFAULT_MULTICAM_SHOT_POLICY.minLayoutLifeMs,
      manifest.constraints.min_shot_ms,
    ),
  };
  const classified = classifyActivity(activity, manifest);
  const desired: MulticamShot[] = [];
  for (const span of classified) {
    desired.push(desiredShot(span, manifest, policy, desired[desired.length - 1]));
  }
  const stable = applyCutLead(
    applyHysteresis(mergeShots(desired), manifest, policy),
    manifest.constraints.cut_lead_ms,
    manifest.constraints.min_shot_ms,
  );
  return {
    spec: "openreel-multicam-edit/v1",
    durationMs: Math.round(activity.duration * 1_000),
    shots: addReactionShots(stable, manifest),
  };
}

interface MulticamEditDirective {
  id: string;
  startMs: number;
  endMs: number;
  cameraId?: string;
  layout?: MulticamLayoutTemplate;
  note?: string;
}

/** Applies validated human/agent directives without changing the cached activity map. */
export function applyMulticamDirectives(
  plan: MulticamShotPlan,
  manifest: MulticamManifest,
  directives: readonly MulticamEditDirective[],
): MulticamShotPlan {
  let shots = plan.shots.map((shot) => structuredClone(shot));
  for (const directive of directives) {
    if (
      !Number.isFinite(directive.startMs) ||
      !Number.isFinite(directive.endMs) ||
      directive.startMs < 0 ||
      directive.endMs <= directive.startMs ||
      directive.endMs > plan.durationMs
    ) {
      throw new Error(`Directive ${directive.id} has an invalid time range`);
    }
    const camera = directive.cameraId
      ? manifest.cameras.find((entry) => entry.id === directive.cameraId)
      : undefined;
    if (directive.cameraId && !camera) {
      throw new Error(`Directive ${directive.id} references an unknown camera`);
    }
    shots = shots.flatMap((shot) => {
      if (shot.endMs <= directive.startMs || shot.startMs >= directive.endMs) return [shot];
      const result: MulticamShot[] = [];
      if (shot.startMs < directive.startMs) result.push({ ...shot, endMs: directive.startMs });
      const startMs = Math.max(shot.startMs, directive.startMs);
      const endMs = Math.min(shot.endMs, directive.endMs);
      const layout = camera
        ? {
            template: camera.type === "wide" ? "wide" as const : "solo" as const,
            panels: [{ cameraId: camera.id, subject: camera.subject, rect: panelRects(1)[0]! }],
          }
        : directive.layout === "wide"
          ? layoutForParticipants(manifest, [], "wide")
          : shot.layout;
      result.push({ ...shot, startMs, endMs, layout, reason: "directive" });
      if (shot.endMs > directive.endMs) result.push({ ...shot, startMs: directive.endMs });
      return result;
    });
  }
  return { ...plan, shots: mergeShots(shots) };
}

export const MULTICAM_POLICY_PRESETS = {
  conversation: {
    ...DEFAULT_MULTICAM_SHOT_POLICY,
    strategy: "hold",
    escalateTo: "wide",
  },
  energetic: {
    ...DEFAULT_MULTICAM_SHOT_POLICY,
    strategy: "winner",
    escalateTo: "progressive",
    layoutEnterMs: 250,
    maxLayoutChangesPerMinute: 10,
  },
  panel: {
    ...DEFAULT_MULTICAM_SHOT_POLICY,
    strategy: "composite",
    escalateTo: "composite",
    maxLayoutChangesPerMinute: 4,
  },
} satisfies Record<string, MulticamShotPolicy>;
