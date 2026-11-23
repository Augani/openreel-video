import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { useSourceMonitorStore } from "./source-monitor-store";

const reset = () =>
  useSourceMonitorStore.setState({
    projectId: null, mediaId: null, externalPreview: null, history: [], positions: {}, marks: {}, position: 0, rate: 0,
  });

describe("Source monitor history keeps each clip's in/out and playhead", () => {
  beforeEach(() => {
    localStorage.clear();
    reset();
  });

  it("reopens a clip from history where it was left, with its marks intact", () => {
    const s = useSourceMonitorStore;
    s.getState().open("a", "p1");
    s.getState().setPosition(7.5);
    s.getState().setMark("a", "in", 2);
    s.getState().setMark("a", "out", 9);
    s.getState().open("b", "p1");
    s.getState().setPosition(3);
    // Going back to A without a time resumes at A's playhead; B's is remembered too.
    s.getState().open("a", "p1");
    expect(s.getState().position).toBe(7.5);
    expect(s.getState().getMarks("a")).toEqual({ in: 2, out: 9 });
    expect(s.getState().getRememberedPosition("b")).toBe(3);
    expect(s.getState().history).toEqual(["a", "b"]);
    // An explicit time (Match Frame) still wins.
    s.getState().open("b", "p1", 11);
    expect(s.getState().position).toBe(11);
    expect(s.getState().getRememberedPosition("a")).toBe(7.5);
  });

  it("survives a reload: history and playheads come back on bindProject", () => {
    const s = useSourceMonitorStore;
    s.getState().open("a", "p1");
    s.getState().setPosition(4);
    s.getState().open("b", "p1");
    reset();
    s.getState().bindProject("p1");
    expect(s.getState().history).toEqual(["b", "a"]);
    expect(s.getState().getRememberedPosition("a")).toBe(4);
    // Other projects do not see it.
    reset();
    s.getState().bindProject("p2");
    expect(s.getState().history).toEqual([]);
  });

  it("forgetHistory drops the entry and its playhead", () => {
    const s = useSourceMonitorStore;
    s.getState().open("a", "p1");
    s.getState().setPosition(4);
    s.getState().open("b", "p1");
    s.getState().forgetHistory("a");
    expect(s.getState().history).toEqual(["b"]);
    expect(s.getState().getRememberedPosition("a")).toBeUndefined();
  });

  it("ignores corrupt persisted history", () => {
    localStorage.setItem("openreel-source-history:p1", "{not json");
    useSourceMonitorStore.getState().bindProject("p1");
    expect(useSourceMonitorStore.getState().history).toEqual([]);
  });
});
