import "../../../test/install-local-storage-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionExecutor,
  ActionHistory,
  type Clip,
  type Project,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { Profiler } from "react";
import { editClipParticles } from "../../../services/clip-particles";
import { keyboardShortcuts } from "../../../services/keyboard-shortcuts";
import { ParticleEffectsSectionWrapper } from "./tabs/ParticleEffectsSectionWrapper";
const clip: Clip = {
  id: "particle-clip",
  trackId: "particle-track",
  mediaId: "video",
  startTime: 2,
  duration: 5,
  inPoint: 0,
  outPoint: 5,
  effects: [],
  audioEffects: [],
  keyframes: [],
  volume: 1,
  transform: {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
  },
};
function project(): Project {
  const p = createEmptyProject("Particles");
  return {
    ...p,
    timeline: {
      ...p.timeline,
      duration: 7,
      tracks: [
        {
          id: clip.trackId,
          name: "Video",
          type: "video",
          clips: [structuredClone(clip)],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
}
beforeEach(() => {
  const history = new ActionHistory();
  history.setAutoGroupWindow(0);
  useProjectStore.setState({
    project: project(),
    hasOpenProject: true,
    actionHistory: history,
    actionExecutor: new ActionExecutor(history),
  });
  useTimelineStore.setState({ playbackLockedReason: null });
  useUIStore.setState({
    effectApplicationClipId: null,
    exportState: { ...useUIStore.getState().exportState, isExporting: false },
  });
});
afterEach(() => {
  cleanup();
  keyboardShortcuts.stopListening();
  vi.restoreAllMocks();
});
describe("canonical particle controls", () => {
  it("stores the selected complete preset in the project and supports one Undo and Redo", async () => {
    render(
      <ParticleEffectsSectionWrapper
        clipId={clip.id}
        clipStartTime={2}
        clipDuration={5}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview Celebration Confetti" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(useProjectStore.getState().project.particleEffects).toHaveLength(
        1,
      ),
    );
    const snapshot = JSON.parse(
      JSON.stringify(useProjectStore.getState().getFullProject()),
    );
    expect(snapshot.particleEffects[0]).toMatchObject({
      clipId: clip.id,
      startTime: 2,
      duration: 5,
      type: "confetti",
      enabled: true,
      config: { particleCount: 200, wind: { x: 30, y: 0, z: 0 } },
    });
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(
      useProjectStore.getState().project.particleEffects ?? [],
    ).toHaveLength(0);
    await act(async () => {
      await useProjectStore.getState().redo();
    });
    expect(useProjectStore.getState().project.particleEffects).toEqual(
      snapshot.particleEffects,
    );
  });

  it("commits complete timing drafts once and preserves exact values through unedited focus", async () => {
    render(
      <ParticleEffectsSectionWrapper
        clipId={clip.id}
        clipStartTime={2}
        clipDuration={5}
      />,
    );
    await add();
    const start = screen.getByRole("textbox", { name: "Start Time" });
    act(() => start.focus());
    fireEvent.change(start, { target: { value: "-" } });
    expect(
      useProjectStore.getState().project.particleEffects![0].startTime,
    ).toBe(2);
    fireEvent.change(start, { target: { value: "1.3" } });
    fireEvent.keyDown(start, { key: "Enter" });
    await waitFor(() =>
      expect(
        useProjectStore.getState().project.particleEffects![0],
      ).toMatchObject({ startTime: 3.3, duration: 3.7 }),
    );
    const duration = screen.getByRole("textbox", { name: "Duration" });
    act(() => duration.focus());
    fireEvent.change(duration, { target: { value: "0.85" } });
    fireEvent.keyDown(duration, { key: "Enter" });
    await waitFor(() =>
      expect(
        useProjectStore.getState().project.particleEffects![0].duration,
      ).toBe(0.85),
    );
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(
      useProjectStore.getState().project.particleEffects![0].duration,
    ).toBe(3.7);
    await act(async () => {
      await useProjectStore.getState().undo();
    });
    expect(
      useProjectStore.getState().project.particleEffects![0],
    ).toMatchObject({ startTime: 2, duration: 5 });
  });
  it.each(["track", "export", "processing"])(
    "guards %s locks in the controls and canonical mutation",
    async (kind) => {
      render(
        <ParticleEffectsSectionWrapper
          clipId={clip.id}
          clipStartTime={2}
          clipDuration={5}
        />,
      );
      await add();
      const state = useProjectStore.getState(),
        scope = {
          projectId: state.project.id,
          clipId: clip.id,
          history: state.actionHistory,
        };
      const before = structuredClone(state.project.particleEffects);
      act(() => {
        if (kind === "track")
          useProjectStore.setState((state) => ({
            project: {
              ...state.project,
              timeline: {
                ...state.project.timeline,
                tracks: state.project.timeline.tracks.map((track) => ({
                  ...track,
                  locked: true,
                })),
              },
            },
          }));
        else if (kind === "export")
          useUIStore.setState({
            exportState: {
              ...useUIStore.getState().exportState,
              isExporting: true,
            },
          });
        else useTimelineStore.setState({ playbackLockedReason: "Testing" });
      });
      expect(screen.getByRole("textbox", { name: "Duration" })).toBeDisabled();
      await editClipParticles(scope, () => []);
      expect(useProjectStore.getState().project.particleEffects).toEqual(
        before,
      );
    },
  );
  it("rejects a stale editing session and does not rerender on unrelated changes", async () => {
    const commits = vi.fn();
    render(
      <Profiler id="particles" onRender={commits}>
        <ParticleEffectsSectionWrapper
          clipId={clip.id}
          clipStartTime={2}
          clipDuration={5}
        />
      </Profiler>,
    );
    const state = useProjectStore.getState(),
      scope = {
        projectId: state.project.id,
        clipId: clip.id,
        history: state.actionHistory,
      };
    commits.mockClear();
    for (let i = 0; i < 60; i++)
      act(() => {
        useProjectStore.setState((state) => ({
          project: {
            ...state.project,
            modifiedAt: state.project.modifiedAt + 1,
          },
        }));
      });
    expect(commits).not.toHaveBeenCalled();
    act(() => {
      useProjectStore.setState({ actionHistory: new ActionHistory() });
    });
    expect(await editClipParticles(scope, () => [])).toBe(false);
    expect(
      useProjectStore.getState().project.particleEffects ?? [],
    ).toHaveLength(0);
  });
});

async function add(name = "Celebration Confetti") {
  fireEvent.click(screen.getByRole("button", { name: `Preview ${name}` }));
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(useProjectStore.getState().project.particleEffects).toHaveLength(1),
  );
}
