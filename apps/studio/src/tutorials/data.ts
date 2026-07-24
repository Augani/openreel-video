import { getBlueprint, validateGraph, type AssetKind, type Graph } from "@openreel/fxpkg";

export interface TutorialStep {
  title: string;
  body: string;
  /** advance automatically once the graph satisfies this */
  check?: (graph: Graph) => boolean;
  /** "Build this step for me" — mutate toward the target stage */
  buildGraph?: () => Graph;
  buildLabel?: string;
}

export interface Tutorial {
  id: string;
  title: string;
  summary: string;
  level: "beginner" | "intermediate";
  kind: AssetKind;
  minutes: number;
  steps: TutorialStep[];
}

/** Keep only the given node ids and the edges between them. */
function subgraph(full: Graph, ids: string[]): Graph {
  const set = new Set(ids);
  return {
    ...full,
    nodes: full.nodes.filter((n) => set.has(n.id)),
    edges: full.edges.filter((e) => set.has(e.fromNode) && set.has(e.toNode)),
  };
}

const clone = () => getBlueprint("clone.three.v1")!.build({});
const warm = () => getBlueprint("warm-look.v1")!.build({});

const hasType = (g: Graph, t: string) => g.nodes.some((n) => n.type === t);
const countType = (g: Graph, t: string) => g.nodes.filter((n) => n.type === t).length;
const isValid = (g: Graph) => validateGraph(g).ok;

const threeOfMe: Tutorial = {
  id: "three-of-me",
  title: "Multiply yourself (Three of Me)",
  summary: "From a blank graph to a finished effect that clones a person three times across the frame.",
  level: "intermediate",
  kind: "effect",
  minutes: 6,
  steps: [
    {
      title: "What we're building",
      body:
        "An effect is a graph of nodes. Video flows in from a Source, gets transformed, and leaves through an Output. We'll detect the person, cut them out, make three copies, and place them over a blurred background. Click Next to begin — at any step you can press “Build this step” to do it for you, or build it yourself from the palette.",
    },
    {
      title: "1 · Detect the person",
      body:
        "Add a Subject Mask node (Detection group in the palette). It produces a mask that separates the person from the background. We also add a Temporal Smooth so the mask doesn't flicker frame-to-frame.",
      check: (g) => hasType(g, "SubjectMask"),
      buildGraph: () => subgraph(clone(), ["src", "mask", "smooth"]),
      buildLabel: "Add Subject Mask",
    },
    {
      title: "2 · Cut them out",
      body:
        "A Cutout node takes the Source and the mask and gives you just the person on transparency. Connect Source → Cutout.source and the mask → Cutout.mask (drag from an output dot to an input dot).",
      check: (g) => hasType(g, "Cutout"),
      buildGraph: () => subgraph(clone(), ["src", "mask", "smooth", "cut"]),
      buildLabel: "Add & wire Cutout",
    },
    {
      title: "3 · Make three copies",
      body:
        "Add three Transform nodes, each fed by the Cutout. Offset them left, center, and right (the x value in each node's properties). That's the “multiply a body” trick — same cutout, three positions.",
      check: (g) => countType(g, "Transform") >= 3,
      buildGraph: () => subgraph(clone(), ["src", "mask", "smooth", "cut", "tl", "tc", "tr"]),
      buildLabel: "Add 3 Transforms",
    },
    {
      title: "4 · Blur the background & stack",
      body:
        "Blur the original Source for a clean backdrop, then Blend the background and the three clones together into the Output. When the graph is fully connected it turns valid and compiles.",
      check: (g) => isValid(g),
      buildGraph: () => clone(),
      buildLabel: "Finish the graph",
    },
    {
      title: "Done — you built an effect!",
      body:
        "Your graph is valid. Press Submit (top bar) to send it for review, or keep tweaking the Transform offsets and background blur in the Inspector. You just went from a blank canvas to a subject-cloning effect.",
    },
  ],
};

const firstFilter: Tutorial = {
  id: "first-filter",
  title: "Your first filter (warm look)",
  summary: "Learn the basics: chain a few color nodes into a filter that compiles to a real GPU shader and previews live.",
  level: "beginner",
  kind: "filter",
  minutes: 4,
  steps: [
    {
      title: "Filters are pixel recipes",
      body:
        "A filter transforms every pixel. It always starts at Source and ends at Output. We'll build a warm cinematic look. Press Next, then build each step yourself or let the tutorial do it.",
    },
    {
      title: "1 · Boost the color",
      body: "Add a Saturation node and connect Source → Saturation. Raise its amount in the Inspector to make colors richer.",
      check: (g) => hasType(g, "Saturation"),
      buildGraph: () => subgraph(warm(), ["src", "sat"]),
      buildLabel: "Add Saturation",
    },
    {
      title: "2 · Add a vignette",
      body: "A Vignette darkens the edges to draw the eye inward. Connect Saturation → Vignette.",
      check: (g) => hasType(g, "Vignette"),
      buildGraph: () => subgraph(warm(), ["src", "sat", "vig"]),
      buildLabel: "Add Vignette",
    },
    {
      title: "3 · Expose a control & finish",
      body:
        "Add a Param (an 'Amount' slider users will see) and Multiply it in, then connect to Output. The graph compiles to WGSL and the preview goes live.",
      check: (g) => isValid(g),
      buildGraph: () => warm(),
      buildLabel: "Finish the filter",
    },
    {
      title: "Done — it compiles & previews!",
      body:
        "Look at the Compiler panel for the generated WGSL and the live WebGPU preview. Drag the Amount slider in the Inspector to see it update. Press Submit to publish.",
    },
  ],
};

export const TUTORIALS: Tutorial[] = [firstFilter, threeOfMe];

export function getTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find((t) => t.id === id);
}
