import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SilentRegion,
  SilenceAnalysisResult,
} from "../../../bridges/silence-cut-bridge";
import { WorkspaceRecipesPanel } from "./WorkspaceRecipesPanel";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { AssetsPanel } from "../AssetsPanel";
import { useEditorWorkspaceStore } from "../../../stores/editor-workspace-store";

const bridge = vi.hoisted(() => ({
  analyzeClip: vi.fn(),
  cutSilence: vi.fn(),
  countSilences: vi.fn(),
}));
vi.mock("../../../bridges/silence-cut-bridge", () => ({
  getSilenceCutBridge: () => bridge,
  DEFAULT_SILENCE_SETTINGS: {
    threshold: -40,
    minSilenceDuration: 0.5,
    paddingBefore: 0.1,
    paddingAfter: 0.1,
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  useProjectStore.getState().createNewProject("Recipe progress QA");
  const project = useProjectStore.getState().project;
  const track = project.timeline.tracks.find(
    (candidate) => candidate.role === "dialogue",
  )!;
  const clip = {
    id: "voice",
    trackId: track.id,
    mediaId: "audio",
    startTime: 0,
    duration: 4,
    inPoint: 0,
    outPoint: 4,
    volume: 1,
    effects: [],
    audioEffects: [],
    keyframes: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
  };
  useProjectStore.setState({
    project: {
      ...project,
      mediaLibrary: {
        items: [
          {
            id: "audio",
            name: "Dialogue.wav",
            type: "audio",
            fileHandle: null,
            blob: new Blob(),
            thumbnailUrl: null,
            waveformData: null,
            metadata: {
              duration: 4,
              width: 0,
              height: 0,
              frameRate: 0,
              sampleRate: 48000,
              channels: 1,
              codec: "pcm",
              fileSize: 0,
            },
          },
        ],
      },
      timeline: {
        ...project.timeline,
        tracks: project.timeline.tracks.map((candidate) =>
          candidate.id === track.id
            ? { ...candidate, clips: [clip] }
            : candidate,
        ),
      },
    },
  });
  useUIStore
    .getState()
    .select({ type: "clip", id: clip.id, trackId: track.id });
});
afterEach(() => {
  cleanup();
  useEditorWorkspaceStore.getState().setSection("media");
});
describe("recipe progress cards", () => {
  it("shows how many silences the recipe would cut in the target clip", async () => {
    bridge.countSilences.mockResolvedValue(3);
    render(<WorkspaceRecipesPanel />);
    expect(await screen.findByTestId("silence-preview")).toHaveTextContent("3 silences found");
    expect(bridge.countSilences).toHaveBeenCalledWith("voice", expect.objectContaining({ minSilenceDuration: 0.6 }));
  });

  it("shows nothing when the clip cannot be scanned", async () => {
    bridge.countSilences.mockResolvedValue(null);
    render(<WorkspaceRecipesPanel />);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    expect(screen.queryByTestId("silence-preview")).not.toBeInTheDocument();
  });

  it("clears a previous project's activity and ignores its late analysis result after switching projects", async () => {
    let finish!: (result: SilenceAnalysisResult) => void;
    bridge.analyzeClip.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    useEditorWorkspaceStore.getState().setSection("recipes");
    render(<AssetsPanel />);
    const card = (await screen.findByRole("heading", { name: "Remove silences" }))
      .closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(
      screen.getByRole("progressbar", { name: "Remove silences progress" }),
    ).toBeInTheDocument();
    act(() =>
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          id: "another-project",
          name: "Another project",
        },
      })),
    );
    expect(
      screen.queryByRole("progressbar", { name: "Remove silences progress" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Recipe source clip" }),
    ).not.toBeInTheDocument();
    await act(async () =>
      finish({
        silentRegions: [{ start: 1, end: 2, duration: 1 }],
        totalSilenceDuration: 1,
        clipDuration: 4,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Cut 1" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run" })).toHaveLength(4);
  });

  it("shows engine progress on the running card and waits for review before applying cuts", async () => {
    let analysisDone!: (result: SilenceAnalysisResult) => void;
    let cutDone!: (result: { success: boolean }) => void;
    bridge.analyzeClip.mockImplementation((_id, _settings, progress) => {
      progress(43, "Finding pauses");
      return new Promise((resolve) => {
        analysisDone = resolve;
      });
    });
    bridge.cutSilence.mockImplementation((_id, _regions, progress) => {
      progress(72, "Closing gaps");
      return new Promise((resolve) => {
        cutDone = resolve;
      });
    });
    render(<WorkspaceRecipesPanel />);
    const card = screen
      .getByRole("heading", { name: "Remove silences" })
      .closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Run" }));
    const viewport = card.closest<HTMLDivElement>(
      "[data-radix-scroll-area-viewport]",
    )!;
    viewport.scrollTop = 240;
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(viewport.scrollTop).toBe(0);
    expect(bridge.analyzeClip).toHaveBeenCalledWith(
      "voice",
      expect.objectContaining({ minSilenceDuration: 0.6 }),
      expect.any(Function),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 4");
    expect(
      screen.getByRole("progressbar", { name: "Remove silences progress" }),
    ).toHaveAttribute("aria-valuenow", "43");
    expect(bridge.cutSilence).not.toHaveBeenCalled();
    const regions: SilentRegion[] = [{ start: 1, end: 2, duration: 1 }];
    await act(async () =>
      analysisDone({
        silentRegions: regions,
        totalSilenceDuration: 1,
        clipDuration: 4,
      }),
    );
    expect(bridge.cutSilence).not.toHaveBeenCalled();
    viewport.scrollTop = 240;
    fireEvent.click(screen.getByRole("button", { name: "Cut 1" }));
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByRole("status")).toHaveTextContent("Step 4 of 4");
    expect(
      screen.getByRole("progressbar", { name: "Remove silences progress" }),
    ).toHaveAttribute("aria-valuenow", "72");
    await act(async () => cutDone({ success: true }));
    expect(
      within(card).getByRole("button", { name: "Done" }),
    ).toBeInTheDocument();
  });
});
