import type { ActionExecutorLike } from "../../services/lazy-action-executor";
import { memo, useEffect, useId, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button, Label, RadioGroup, RadioGroupItem } from "@openreel/ui";
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useOnboardingStore } from "../../stores/onboarding-store";

const formats = [
  {
    label: "16:9",
    description: "YouTube, desktop",
    width: 1920,
    height: 1080,
    previewWidth: 64,
    previewHeight: 36,
  },
  {
    label: "9:16",
    description: "Reels, TikTok, Shorts",
    width: 1080,
    height: 1920,
    previewWidth: 34,
    previewHeight: 60,
  },
  {
    label: "1:1",
    description: "Feed posts",
    width: 1080,
    height: 1080,
    previewWidth: 46,
    previewHeight: 46,
  },
  {
    label: "4:5",
    description: "Portrait feed",
    width: 1080,
    height: 1350,
    previewWidth: 42,
    previewHeight: 52,
  },
];
type ProjectOwner = { projectId: string; executor: ActionExecutorLike };
const sameOwner = (a: ProjectOwner | null, b: ProjectOwner) =>
  a?.projectId === b.projectId && a.executor === b.executor;
const hasProjectContent = (project: Project) =>
  Boolean(
    project.mediaLibrary.items.length ||
      project.timeline.duration ||
      project.timeline.tracks.some((track) => track.clips.length) ||
      project.timeline.subtitles.length ||
      project.textClips?.length ||
      project.shapeClips?.length ||
      project.svgClips?.length ||
      project.stickerClips?.length ||
      project.particleEffects?.length ||
      project.adjustmentLayers?.length ||
      project.nestedInstances?.length ||
      project.motionInstances?.length,
  );

export const EmptyProjectStart = memo(function EmptyProjectStart() {
  const { projectId, width, height, executor, hasContent } = useProjectStore(
    useShallow(({ project, actionExecutor }) => ({
      projectId: project.id,
      width: project.settings.width,
      height: project.settings.height,
      executor: actionExecutor,
      hasContent: hasProjectContent(project),
    })),
  );
  const owner = { projectId, executor };
  // The welcome cards and onboarding wizards already chose this project's format (spec 3.4).
  const formatChosen = useOnboardingStore(
    (state) => state.formatChosenProjectId === projectId,
  );
  const id = useId();
  const [draft, setDraft] = useState<
    (ProjectOwner & { format: string }) | null
  >(null);
  const [created, setCreated] = useState<ProjectOwner | null>(null);
  const [pending, setPending] = useState<ProjectOwner | null>(null);
  const [failure, setFailure] = useState<
    (ProjectOwner & { message: string }) | null
  >(null);
  const request = useRef<ProjectOwner | null>(null);
  useEffect(() => {
    setDraft(null);
    setCreated(null);
    setPending(null);
    setFailure(null);
    request.current = null;
    return () => {
      request.current = null;
    };
  }, [projectId, executor]);
  const currentFormat = formats.find(
    (format) => width * format.height === height * format.width,
  );
  const selected = sameOwner(draft, owner)
    ? draft!.format
    : (currentFormat?.label ?? "");
  const busy = sameOwner(pending, owner);

  const create = async () => {
    const state = useProjectStore.getState();
    if (
      state.project.id !== projectId ||
      state.actionExecutor !== executor ||
      state.project.settings.width !== width ||
      state.project.settings.height !== height ||
      hasProjectContent(state.project) ||
      sameOwner(request.current, owner)
    )
      return;
    const preset = formats.find((format) => format.label === selected);
    // Keeping the current aspect also keeps custom dimensions such as 4K.
    if (!preset || preset.width * height === width * preset.height) {
      setCreated(owner);
      return;
    }
    const lease = owner;
    request.current = lease;
    setPending(lease);
    setFailure(null);
    const ownsResult = () => {
      const current = useProjectStore.getState();
      return (
        request.current === lease &&
        current.project.id === projectId &&
        current.actionExecutor === executor
      );
    };
    try {
      const result = await state.updateSettings({
        width: preset.width,
        height: preset.height,
      });
      if (!ownsResult()) return;
      if (result.success) setCreated(owner);
      else
        setFailure({
          ...owner,
          message:
            result.error?.message ||
            "Could not update the project format. Try again.",
        });
    } catch {
      if (ownsResult())
        setFailure({
          ...owner,
          message: "Could not update the project format. Try again.",
        });
    } finally {
      if (request.current === lease) {
        request.current = null;
        setPending(null);
      }
    }
  };

  if (formatChosen || sameOwner(created, owner) || hasContent) return null;
  return (
    <div className="workspace-empty-project">
      <div className="workspace-project-card">
        <h1>Start your project</h1>
        <p>Pick a format. You can change it any time in Settings.</p>
        <RadioGroup
          className="workspace-formats"
          aria-label="Project format"
          value={selected}
          disabled={busy}
          onValueChange={(format) => {
            setDraft({ ...owner, format });
            setFailure(null);
          }}
        >
          {formats.map((format) => (
            <Label
              key={format.label}
              htmlFor={`${id}-${format.label}`}
              data-selected={selected === format.label}
              data-disabled={busy || undefined}
            >
              <RadioGroupItem
                id={`${id}-${format.label}`}
                value={format.label}
                className="sr-only"
                aria-label={`${format.label} ${format.description}`}
              />
              <span className="workspace-format-icon" aria-hidden="true">
                <span
                  style={{
                    width: format.previewWidth,
                    height: format.previewHeight,
                  }}
                />
              </span>
              <strong>{format.label}</strong>
              <small>{format.description}</small>
            </Label>
          ))}
        </RadioGroup>
        {!currentFormat && !sameOwner(draft, owner) && (
          <p className="workspace-current-format">
            Current format: {width} × {height}. Choose a preset to change it.
          </p>
        )}
        {sameOwner(failure, owner) && <p role="alert">{failure!.message}</p>}
        <footer>
          <p>Or drop footage anywhere to match its format</p>
          <Button disabled={busy} onClick={() => void create()}>
            Create project
          </Button>
        </footer>
      </div>
    </div>
  );
});
