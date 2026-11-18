import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceEdit } from "./useVoiceEdit";
class Recognition {
  static current: Recognition;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.current = this; }
}
beforeEach(() => { vi.stubGlobal("SpeechRecognition",Recognition); vi.stubGlobal("webkitSpeechRecognition",undefined); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("voice edit input", () => {
  it("starts only on a user request and appends final results without sending an edit", () => {
    const append = vi.fn(); const { result } = renderHook(() => useVoiceEdit(true,append));
    expect(result.current.listening).toBe(false);
    act(() => result.current.toggle());
    expect(Recognition.current.start).toHaveBeenCalledOnce();
    act(() => Recognition.current.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:"  Add captions  "}}]}));
    expect(append).toHaveBeenCalledWith("Add captions");
    act(() => result.current.toggle());
    expect(Recognition.current.stop).toHaveBeenCalledOnce();
    act(() => Recognition.current.onend?.()); expect(result.current.listening).toBe(false);
  });
  it("aborts on close/busy and ignores a late captured callback", () => {
    const append = vi.fn(); const { result, rerender } = renderHook(({enabled}) => useVoiceEdit(enabled,append),{initialProps:{enabled:true}});
    act(() => result.current.toggle());
    const recognition = Recognition.current, late = recognition.onresult;
    rerender({enabled:false}); expect(recognition.abort).toHaveBeenCalledOnce();
    act(() => late?.({resultIndex:0,results:[{isFinal:true,0:{transcript:"Late"}}]}));
    expect(append).not.toHaveBeenCalled(); expect(result.current.listening).toBe(false);
  });
  it("reports denied access and releases the recognizer", () => {
    const { result } = renderHook(() => useVoiceEdit(true,vi.fn()));
    act(() => result.current.toggle());
    act(() => Recognition.current.onerror?.({error:"not-allowed"}));
    expect(result.current.error).toContain("Microphone access was not allowed");
    expect(Recognition.current.abort).toHaveBeenCalledOnce(); expect(result.current.listening).toBe(false);
  });
});
