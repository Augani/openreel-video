import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@openreel/core";
import { TimeRuler } from "./TimeRuler";
import { TrackLane } from "./TrackLane";
import { useUIStore } from "../../../stores/ui-store";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("timeline scrolled coordinates", () => {
  it.each([
    { phone: true, left: -45, x: 195, pps: 24, scroll: 45, time: 10 },
    { phone: false, left: -200, x: 500, pps: 100, scroll: 200, time: 7 },
  ])("seeks the ruler's actual time with phone=$phone", ({ phone, left, x, pps, scroll, time }) => {
    const seek = vi.fn();
    const view = render(<div><div><TimeRuler duration={60} pixelsPerSecond={pps}
      scrollX={scroll} viewportWidth={390} phone={phone} onSeek={seek} /></div></div>);
    const ruler = view.container.querySelector("[data-timeline-ruler]")!;
    vi.spyOn(ruler, "getBoundingClientRect").mockReturnValue(new DOMRect(left, 0, 1440, 22));
    fireEvent.mouseDown(ruler, { clientX: x, button: 0 });
    expect(seek).toHaveBeenCalledWith(time);
    fireEvent.mouseUp(document);
  });

  it("does not add the scroll offset twice when dropping into an already scrolled lane", () => {
    useUIStore.setState({ snapSettings: { ...useUIStore.getState().snapSettings, enabled: false } });
    const track: Track = { id: "main", type: "video", name: "Main", clips: [], transitions: [],
      muted: false, hidden: false, locked: false, solo: false };
    const drop = vi.fn();
    const noop = () => {};
    const view = render(<TrackLane track={track} allTracks={[track]} pixelsPerSecond={24}
      selectedClipIds={[]} textClips={[]} shapeClips={[]} trackHeights={new Map([[track.id, 68]])}
      timelineRef={{ current: null }} onSelectClip={noop} onDropMedia={drop} onMoveClip={noop}
      onMoveTextClip={noop} onSnapIndicator={noop} onTrimTextClip={noop} onTrimShapeClip={noop}
      scrollX={45} trackHeight={68} onResizeTrack={noop} onSelectTransition={noop} phone />);
    const lane = view.container.firstElementChild!.firstElementChild!;
    vi.spyOn(lane, "getBoundingClientRect").mockReturnValue(new DOMRect(-45, 0, 1440, 60));
    const event = new MouseEvent("drop", { bubbles: true, clientX: 195 });
    Object.defineProperty(event, "dataTransfer", { value: { files: [], getData: () => JSON.stringify({ mediaId: "video" }) } });
    fireEvent(lane, event);
    expect(drop).toHaveBeenCalledWith("main", "video", 10);
  });
});
