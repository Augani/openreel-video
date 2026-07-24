import type { AssetKind, Graph, GraphEdge, GraphNode } from "@openreel/fxpkg";
import { getBehavior, type DetectorRequirement } from "./behaviors/registry";
import { getSubjectCapability } from "./subjects";
import type { Scene, SceneCompileResult, Subject } from "./scene";

interface CompileOptions {
  kind: AssetKind;
}

const DETECTOR_NODE_TYPE: Record<DetectorRequirement, string> = {
  subject_mask: "SubjectMask",
  face_landmarks: "FaceLandmarker",
};

const DETECTOR_OUTPUT_PORT: Record<DetectorRequirement, string> = {
  subject_mask: "mask",
  face_landmarks: "buf",
};

export function sceneToGraph(scene: Scene, opts: CompileOptions): SceneCompileResult {
  const errors: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let counter = 0;
  const mkId = (prefix: string): string => `${prefix}-${++counter}`;

  const source: GraphNode = { id: "source", type: "Source", position: { x: 16, y: 200 } };
  nodes.push(source);

  const seenKinds = new Set<Subject["kind"]>();
  const visibleSubjects: Subject[] = [];
  for (const s of scene.subjects) {
    if (!s.visible) continue;
    if (seenKinds.has(s.kind)) {
      errors.push(`Duplicate subject kind: ${s.kind}`);
      continue;
    }
    seenKinds.add(s.kind);
    visibleSubjects.push(s);
  }

  const detectorNodeIds: Record<DetectorRequirement, string | null> = {
    subject_mask: null,
    face_landmarks: null,
  };

  for (const subject of visibleSubjects) {
    const cap = getSubjectCapability(subject.kind);
    if (cap.detector === "ImageSegmenter" && !detectorNodeIds.subject_mask) {
      const id = mkId("subject-mask");
      detectorNodeIds.subject_mask = id;
      nodes.push({ id, type: DETECTOR_NODE_TYPE.subject_mask });
      edges.push({ fromNode: source.id, fromPort: "out", toNode: id, toPort: "src" });
    }
    if (cap.detector === "FaceLandmarker" && !detectorNodeIds.face_landmarks) {
      const id = mkId("face-landmarks");
      detectorNodeIds.face_landmarks = id;
      nodes.push({ id, type: DETECTOR_NODE_TYPE.face_landmarks });
      edges.push({ fromNode: source.id, fromPort: "out", toNode: id, toPort: "src" });
    }
  }

  let lastNode = source.id;
  let lastPort = "out";

  for (const subject of visibleSubjects) {
    for (const behavior of subject.behaviors) {
      if (!behavior.visible) continue;
      const lookupId =
        behavior.kind === "preset" ? behavior.presetId : `atomic.${behavior.atomicKind}`;
      const def = getBehavior(lookupId);
      if (!def) {
        errors.push(`Unknown behavior: ${lookupId}`);
        continue;
      }
      if (!def.acceptsSubjects.includes(subject.kind)) {
        errors.push(`Behavior ${def.id} does not accept subject kind ${subject.kind}`);
        continue;
      }
      const parsed = def.paramSchema.safeParse(behavior.params);
      if (!parsed.success) {
        errors.push(`Behavior ${def.id} params invalid: ${parsed.error.message}`);
        continue;
      }
      const ctx = {
        uniqueId: (prefix: string): string => mkId(prefix),
        paramRef: (id: string): string => `param.${id}`,
      };
      const fragment = def.emit(ctx, subject, parsed.data);

      for (const fragNode of fragment.nodes) nodes.push(fragNode);
      for (const fragEdge of fragment.edges) edges.push(fragEdge);

      for (const ip of fragment.inputPorts) {
        edges.push({ fromNode: lastNode, fromPort: lastPort, toNode: ip.node, toPort: ip.port });
      }

      for (const di of fragment.detectionInputs ?? []) {
        const detectorId = detectorNodeIds[di.require];
        if (!detectorId) {
          errors.push(
            `Behavior ${def.id} requires ${di.require} but the scene has no corresponding subject`,
          );
          continue;
        }
        const outPort = DETECTOR_OUTPUT_PORT[di.require];
        edges.push({
          fromNode: detectorId,
          fromPort: outPort,
          toNode: di.node,
          toPort: di.port,
        });
      }

      lastNode = fragment.outputPort.node;
      lastPort = fragment.outputPort.port;
    }
  }

  const output: GraphNode = { id: "output", type: "Output", position: { x: 1600, y: 200 } };
  nodes.push(output);
  edges.push({ fromNode: lastNode, fromPort: lastPort, toNode: output.id, toPort: "in" });

  if (errors.length > 0) return { ok: false, errors };

  const graph: Graph = {
    id: `scene-${Math.random().toString(36).slice(2, 8)}`,
    kind: opts.kind,
    abi: "1.0",
    nodelibVersion: "1.0.0",
    nodes,
    edges,
    params: [],
  };

  return { ok: true, graph };
}
