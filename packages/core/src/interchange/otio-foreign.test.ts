import { describe, expect, it } from "vitest";
import { parseOtio } from "./index";

const foreign = (clip: Record<string, unknown>, ref: Record<string, unknown>): string =>
  JSON.stringify({
    OTIO_SCHEMA: "Timeline.1",
    name: "f",
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          kind: "Video",
          children: [
            {
              OTIO_SCHEMA: "Clip.1",
              name: "c",
              media_reference: { OTIO_SCHEMA: "ExternalReference.1", ...ref },
              ...clip,
            },
          ],
        },
      ],
    },
  });

const avail = {
  OTIO_SCHEMA: "TimeRange.1",
  start_time: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 10 },
  duration: { OTIO_SCHEMA: "RationalTime.1", rate: 24, value: 48 },
};

describe("foreign-style OTIO robustness", () => {
  it("a clip with a null source_range plays its whole available range", () => {
    const { sequence } = parseOtio(foreign({ source_range: null }, { target_url: "file:///a/b.mov", available_range: avail }));
    const c = sequence.tracks[0].clips[0];
    expect(c.endFrame - c.startFrame).toBe(48);
    expect(c.inSec).toBeCloseTo(10 / 24, 9);
  });

  it("windows paths and malformed percent escapes do not break media naming", () => {
    const win = parseOtio(foreign({ source_range: avail }, { target_url: "C:\\media\\shot 1.mov", available_range: avail }));
    expect(win.sequence.media[0].name).toBe("shot 1.mov");
    const bad = parseOtio(foreign({ source_range: avail }, { target_url: "file:///x/100%.mov", available_range: avail }));
    expect(bad.sequence.media[0].name).toBe("100%.mov");
  });
});
