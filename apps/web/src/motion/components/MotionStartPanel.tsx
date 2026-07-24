import type { JSX } from "react";
import {
  Box,
  Diamond,
  GitBranch,
  ImagePlus,
  Library,
  LineChart,
  PackageCheck,
  Radar,
  Scissors,
  Shapes,
  Sparkles,
  Type,
  Wand2,
  Waves,
  Zap,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import type { MotionComposition } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import {
  useMotionStore,
  type MotionLeftTab,
  type MotionRightTab,
} from "../stores/motion-store";
import { PanelHeader } from "./primitives";

interface MotionStartPanelProps {
  composition: MotionComposition;
}

interface StartAction {
  readonly label: string;
  readonly detail: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

export function MotionStartPanel({
  composition,
}: MotionStartPanelProps): JSX.Element {
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setLeftTab = useMotionStore((state) => state.setLeftTab);
  const setRightTab = useMotionStore((state) => state.setRightTab);

  const openLeft = (tab: MotionLeftTab) => {
    setLeftTab(tab);
  };

  const openRight = (tab: MotionRightTab) => {
    setRightTab(tab);
  };

  const addLayer = (
    type: CreatableMotionLayerType,
    rightTab: MotionRightTab = "properties",
  ) => {
    const layer = createMotionLayerOfType(composition, type);
    void upsertMotionComposition({
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    setLeftTab("layers");
    setRightTab(rightTab);
  };

  const workflowSections: Array<{
    readonly title: string;
    readonly actions: StartAction[];
  }> = [
    {
      title: "Open",
      actions: [
        {
          label: "Templates",
          detail: "Logo reveals, kinetic type, product shots",
          icon: Sparkles,
          run: () => openLeft("templates"),
        },
        {
          label: "Assets",
          detail: "Footage, images, SVG, Lottie",
          icon: Library,
          run: () => openLeft("assets"),
        },
      ],
    },
    {
      title: "Build",
      actions: [
        {
          label: "Text",
          detail: "Type, glyph shaders, text animators",
          icon: Type,
          run: () => addLayer("text", "properties"),
        },
        {
          label: "Shape",
          detail: "Vectors, gradients, trim paths",
          icon: Shapes,
          run: () => addLayer("shape", "properties"),
        },
        {
          label: "3D Scene",
          detail: "Objects, camera, lights, materials",
          icon: Box,
          run: () => addLayer("scene3d", "properties"),
        },
        {
          label: "Particles",
          detail: "Emitters, loops, sparkle systems",
          icon: Zap,
          run: () => addLayer("particle", "properties"),
        },
      ],
    },
    {
      title: "Animate",
      actions: [
        {
          label: "Presets",
          detail: "Entrance, emphasis, exits, loops",
          icon: Diamond,
          run: () => openRight("presets"),
        },
        {
          label: "Graph",
          detail: "Curves, easing, expressions",
          icon: LineChart,
          run: () => openRight("graph"),
        },
        {
          label: "Effects",
          detail: "Stacked FX and shader passes",
          icon: Wand2,
          run: () => openRight("effects"),
        },
        {
          label: "Masks",
          detail: "Track mattes and alpha control",
          icon: Scissors,
          run: () => openRight("masks"),
        },
      ],
    },
    {
      title: "Finish",
      actions: [
        {
          label: "Sync",
          detail: "Audio, beat, text timing",
          icon: Waves,
          run: () => openRight("sync"),
        },
        {
          label: "Track",
          detail: "Pin motion to subjects or objects",
          icon: Radar,
          run: () => openRight("tracker"),
        },
        {
          label: "Variables",
          detail: "Template controls and overrides",
          icon: GitBranch,
          run: () => openRight("variables"),
        },
        {
          label: "Queue",
          detail: "MP4, alpha, ProRes deliverables",
          icon: PackageCheck,
          run: () => openRight("queue"),
        },
      ],
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Start" icon={ImagePlus} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        {workflowSections.map((section) => (
          <section key={section.title} className="space-y-2">
            <div className="flex items-center justify-between">
              <ToolcraftText
                as="h2"
                type="label"
                color="primary"
                weight="semibold"
                className="text-[12px]"
              >
                {section.title}
              </ToolcraftText>
              <span className="h-px flex-1 bg-border ml-2" aria-hidden />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {section.actions.map((action) => {
                const Icon = action.icon;
                return (
                  <ToolcraftClickableCard
                    key={action.label}
                    label={action.label}
                    onClick={action.run}
                    variant="muted"
                    padding={2}
                    className="min-h-[78px]"
                  >
                    <ToolcraftText
                      as="span"
                      type="label"
                      color="primary"
                      weight="semibold"
                      className="mb-1.5 flex items-center gap-1.5"
                    >
                      <Icon size={13} aria-hidden />
                      {action.label}
                    </ToolcraftText>
                    <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                      {action.detail}
                    </ToolcraftText>
                  </ToolcraftClickableCard>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
