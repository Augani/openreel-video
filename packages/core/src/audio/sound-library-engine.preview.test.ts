import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoundLibraryEngine } from "./sound-library-engine";
import type { SoundItem } from "../types/sound-library";

vi.mock("./sound-generator", () => ({ getSoundGenerator: () => new Proxy({}, {
  get: () => async (id: string, name: string) => ({ item: { id, name, category: "music" }, blob: new Blob(["audio"]), dataUrl: "data:audio/wav;base64,AA==" }),
}) }));
const sound: SoundItem = { id: "first", name: "First", category: "music", subcategory: "cinematic", duration: 999, tags: [], previewUrl: "https://preview.test/first", downloadUrl: "", isBuiltin: true, license: "royalty-free" };
function createContext() {
  return { currentTime: 10, state: "running", resume: vi.fn(async () => {}), decodeAudioData: vi.fn(async () => ({ duration: 8 })), destination: {},
    createBufferSource: vi.fn(() => ({ onended: null as (() => void) | null, buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
    createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })),
  };
}
let context: ReturnType<typeof createContext>;
beforeEach(() => {
  context = createContext();
  vi.stubGlobal("AudioContext", vi.fn(() => context));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
});
afterEach(() => { vi.unstubAllGlobals(); });
describe("sound preview audio clock", () => {
  it("pauses at the actual offset and resumes the decoded buffer without another fetch", async () => {
    const engine = new SoundLibraryEngine(); await engine.ensureInitialized();
    const ended = vi.fn(); await engine.previewSound(sound, ended);
    context.currentTime = 12;
    expect(engine.pausePreview(sound.id)).toBe(true);
    expect(engine.getPreviewProgress(sound.id)).toBe(0.25);
    context.currentTime = 100;
    expect(engine.getPreviewProgress(sound.id)).toBe(0.25);
    expect(await engine.resumePreview(sound.id)).toBe(true);
    expect(context.createBufferSource.mock.results[1].value.start).toHaveBeenCalledWith(0, 2);
    expect(fetch).toHaveBeenCalledOnce();
    expect(context.decodeAudioData).toHaveBeenCalledOnce();
    context.currentTime = 102;
    expect(engine.getPreviewProgress(sound.id)).toBe(0.5);
    context.createBufferSource.mock.results[1].value.onended!();
    expect(ended).toHaveBeenCalledOnce();
    expect(engine.getPreviewProgress(sound.id)).toBe(0);
  });

  it("stops a paused preview and never resumes it after another preview has taken ownership", async () => {
    const engine = new SoundLibraryEngine(); await engine.ensureInitialized();
    await engine.previewSound(sound);
    context.currentTime = 12;
    expect(engine.pausePreview(sound.id)).toBe(true);
    engine.stopPreview();
    expect(await engine.resumePreview(sound.id)).toBe(false);
    await engine.previewSound({ ...sound, id: "second" });
    expect(await engine.resumePreview(sound.id)).toBe(false);
    expect(engine.pausePreview(sound.id)).toBe(false);
    context.currentTime = 14;
    expect(engine.getPreviewProgress("second")).toBe(0.25);
    engine.stopPreview();
  });

  it("does not revive a stopped preview when an audio-context resume completes late", async () => {
    const engine = new SoundLibraryEngine(); await engine.ensureInitialized();
    await engine.previewSound(sound);
    expect(engine.pausePreview(sound.id)).toBe(true);
    context.state = "suspended";
    let finish!: () => void;
    context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const resuming = engine.resumePreview(sound.id);
    engine.stopPreview();
    finish();
    expect(await resuming).toBe(false);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(engine.getPreviewProgress(sound.id)).toBe(0);
  });

  it("ignores the old source's end event and makes repeated Resume idempotent", async () => {
    const engine = new SoundLibraryEngine(); await engine.ensureInitialized();
    const ended = vi.fn(); await engine.previewSound(sound, ended);
    const oldEnded = context.createBufferSource.mock.results[0].value.onended!;
    context.currentTime = 12;
    engine.pausePreview(sound.id);
    expect(await engine.resumePreview(sound.id)).toBe(true);
    expect(await engine.resumePreview(sound.id)).toBe(true);
    oldEnded();
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
    expect(ended).not.toHaveBeenCalled();
    expect(engine.getPreviewProgress(sound.id)).toBe(0.25);
    engine.stopPreview();
  });

  it("retains the paused buffer after a failed context resume so it can be retried", async () => {
    const engine = new SoundLibraryEngine(); await engine.ensureInitialized();
    await engine.previewSound(sound);
    context.currentTime = 12;
    engine.pausePreview(sound.id);
    context.state = "suspended";
    context.resume.mockRejectedValueOnce(new Error("resume denied"));
    await expect(engine.resumePreview(sound.id)).rejects.toThrow("resume denied");
    expect(engine.getPreviewProgress(sound.id)).toBe(0.25);
    expect(await engine.resumePreview(sound.id)).toBe(true);
    expect(context.createBufferSource.mock.results[1].value.start).toHaveBeenCalledWith(0, 2);
    engine.stopPreview();
  });

  it("does not let a stale decode replace a newer preview clock", async () => {
    const engine = new SoundLibraryEngine(); await engine.ensureInitialized();
    let finish!: (value: { duration: number }) => void;
    context.decodeAudioData.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = engine.previewSound(sound);
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce());
    await engine.previewSound({ ...sound, id: "second" });
    context.currentTime = 14;
    finish({ duration: 30 }); await first;
    expect(engine.getPreviewProgress(sound.id)).toBe(0);
    expect(engine.getPreviewProgress("second")).toBe(0.5);
    engine.stopPreview();
  });
});
