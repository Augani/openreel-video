import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../../stores/settings-store";
import { VoiceBrowser } from "./VoiceBrowser";

describe("Voice browser favorites", () => {
  const originalFavorites = useSettingsStore.getState().favoriteVoices;
  const audio = { crossOrigin: "", src: "", onended: null, onerror: null, play: vi.fn(), pause: vi.fn() };

  beforeEach(() => {
    audio.play.mockResolvedValue(undefined);
    audio.pause.mockClear();
    vi.stubGlobal("Audio", vi.fn(function () { return audio; }));
    useSettingsStore.setState({ favoriteVoices: [{ voiceId: "voice-1", name: "Test Voice", previewUrl: "/test-voice.mp3" }] });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ favoriteVoices: originalFavorites });
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("selects a favorite exactly once per activation", () => {
    const onSelectVoice = vi.fn();
    render(<VoiceBrowser selectedVoice="" onSelectVoice={onSelectVoice} allVoices={[]} isLoadingVoices={false} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Test Voice" }));
    expect(onSelectVoice).toHaveBeenCalledOnce();
    expect(onSelectVoice).toHaveBeenCalledWith("voice-1");
  });

  it("previews without selecting and stops audio when the browser closes", () => {
    const onSelectVoice = vi.fn();
    const view = render(<VoiceBrowser selectedVoice="" onSelectVoice={onSelectVoice} allVoices={[]} isLoadingVoices={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview voice" }));
    expect(audio.play).toHaveBeenCalledOnce();
    expect(onSelectVoice).not.toHaveBeenCalled();
    view.unmount();
    expect(audio.pause).toHaveBeenCalledOnce();
  });
});
