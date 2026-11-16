import "../../../test/install-local-storage-mock";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionTrackingState } from "../../../bridges/motion-tracking-bridge";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { MotionTrackingSection } from "./MotionTrackingSection";
const mocks = vi.hoisted(() => ({ start: vi.fn(), apply: vi.fn(), remove: vi.fn(), cancel: vi.fn(), listener: null as null | ((state: MotionTrackingState) => void), snapshot: null as MotionTrackingState | null, analysis: null as unknown, application: null as null | { sourceClipId: string; options: { offset: { x: number; y: number }; applyScale: boolean; applyRotation: boolean; smoothing: number; mode: "follow" | "pin" } } }));
const bridge = { startTracking: mocks.start, applyTrackingToClip: mocks.apply, removeAttachment: mocks.remove, cancelTracking: mocks.cancel, getState: () => mocks.snapshot!, subscribe: (listener: (state: MotionTrackingState) => void) => { mocks.listener = listener; listener(mocks.snapshot!); return () => { mocks.listener = null; }; } };
vi.mock("../../../bridges/motion-tracking-bridge", () => ({ getMotionTrackingBridge: () => bridge }));
vi.mock("../../../services/motion-tracking-edit", () => ({ TRACKING_APPLICATION: "workspaceMotionTrackingApplication", readMotionTrackingAnalysis: () => mocks.analysis, readMotionTrackingApplication: (id: string) => id === "title" ? mocks.application : null, getMotionTrackingTarget: () => ({ clip: { trackId: "track" }, normalized: false }) }));
beforeEach(() => {
  vi.clearAllMocks(); mocks.analysis = null; mocks.application = null; mocks.snapshot = { isTracking: false, progress: 0, currentJob: null, trackingData: null, lostFrames: [], error: null };
  useProjectStore.getState().createNewProject("Tracking controls"); const project = useProjectStore.getState().project;
  useProjectStore.setState({ project: { ...project, settings: { ...project.settings, frameRate: 24 }, timeline: { ...project.timeline, tracks: [{ id: "track", type: "video", name: "Video", locked: false, hidden: false, muted: false, solo: false, transitions: [], clips: [{ id: "source", mediaId: "media", trackId: "track", startTime: 0, duration: 3, inPoint: 0, outPoint: 3, effects: [], audioEffects: [], keyframes: [], volume: 1, transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, opacity: 1, rotation: 0, anchor: { x: .5, y: .5 } } }] }] }, mediaLibrary: { items: [{ id: "media", type: "video", name: "Real source", blob: null, fileHandle: null, thumbnailUrl: null, waveformData: null, metadata: { width: 640, height: 360, duration: 3, frameRate: 30, codec: "h264", sampleRate: 0, channels: 0, fileSize: 0 } }] } } });
  useUIStore.setState({ exportState: { isExporting: false, progress: 0, phase: "" } }); mocks.start.mockResolvedValue({ id: "job" }); mocks.apply.mockResolvedValue(true);
});
afterEach(cleanup);
describe("motion tracking shadcn controls", () => {
  it("commits keyboard region drafts and requests real clip tracking without fixed frame bounds", async () => {
    render(<MotionTrackingSection clipId="source" />); expect(screen.getByText(/72 frames at 24 fps/)).toBeInTheDocument();
    const input = screen.getByRole("spinbutton", { name: "X Position" }); fireEvent.focus(input); fireEvent.change(input, { target: { value: "42" } }); fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Start Tracking" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith("source", expect.objectContaining({ x: 42 }), { algorithm: "correlation", confidenceThreshold: .7 }));
  });
  it("cancels its own pending decode on unmount", async () => {
    const view = render(<MotionTrackingSection clipId="source" />); fireEvent.click(screen.getByRole("button", { name: "Start Tracking" }));
    await act(async () => { mocks.snapshot = { ...mocks.snapshot!, isTracking: true }; mocks.listener?.(mocks.snapshot); }); view.unmount(); expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
  it("does not cancel a different clip's active job", () => {
    const view = render(<MotionTrackingSection clipId="source" />); mocks.snapshot = { ...mocks.snapshot!, isTracking: true, currentJob: { id: "other", clipId: "other" } as MotionTrackingState["currentJob"] };
    view.unmount(); expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
