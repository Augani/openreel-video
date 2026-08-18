import { describe, expect, it } from "vitest";
import { getClipWaveformBarAmplitudes } from "./utils";

describe("getClipWaveformBarAmplitudes", () => {
  it("keeps silent waveform buckets at zero", () => {
    expect(
      getClipWaveformBarAmplitudes(new Float32Array(100), {
        barCount: 5,
        mediaDuration: 10,
        inPoint: 0,
        outPoint: 10,
      }),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it("does not invent a waveform while source data is unavailable", () => {
    expect(
      getClipWaveformBarAmplitudes(null, {
        barCount: 4,
        mediaDuration: 10,
        inPoint: 0,
        outPoint: 10,
      }),
    ).toEqual([0, 0, 0, 0]);
  });

  it("samples only the source range used by a trimmed clip", () => {
    expect(
      getClipWaveformBarAmplitudes(
        new Float32Array([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]),
        {
          barCount: 4,
          mediaDuration: 10,
          inPoint: 2,
          outPoint: 6,
        },
      ),
    ).toEqual([
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(0.4),
      expect.closeTo(0.5),
    ]);
  });

  it("aggregates peaks and reverses their display order when needed", () => {
    expect(
      getClipWaveformBarAmplitudes(new Float32Array([0, 0.8, 0, 0.4]), {
        barCount: 2,
        mediaDuration: 4,
        inPoint: 0,
        outPoint: 4,
        reversed: true,
      }),
    ).toEqual([expect.closeTo(0.4), expect.closeTo(0.8)]);
  });
});
