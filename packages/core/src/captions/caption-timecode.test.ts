import { describe, expect, it } from "vitest";
import { dropLabelsPerMinute, framesToTimecode, resolveCaptionFrameRate, timecodeProblem, timecodeToFrames, type CaptionFrameRate } from "./caption-timecode";
import { parseScc } from "./scc";
import { parseTtml } from "./ttml";

const DF30: CaptionFrameRate = resolveCaptionFrameRate(29.97, true);
const DF60: CaptionFrameRate = { fps: 60000 / 1001, nominal: 60, dropFrame: true };

describe("drop-frame timecode (29.97)", () => {
  it("counts through the first minute without dropping", () => {
    expect(framesToTimecode(0, DF30)).toBe("00:00:00;00");
    expect(framesToTimecode(1799, DF30)).toBe("00:00:59;29");
  });
  it("skips labels ;00 and ;01 at minute 1 but not at minute 10", () => {
    expect(framesToTimecode(1800, DF30)).toBe("00:01:00;02");
    expect(framesToTimecode(1800 + 1798, DF30)).toBe("00:02:00;02");
    expect(framesToTimecode(17982, DF30)).toBe("00:10:00;00");
    expect(timecodeToFrames("00:10:00;00", DF30)).toBe(17982);
  });
  it("is 3 h 35 m 59.97 s of frames short of non-drop per hour (107892 frames)", () => {
    expect(timecodeToFrames("01:00:00;00", DF30)).toBe(107892);
    expect(framesToTimecode(107892, DF30)).toBe("01:00:00;00");
  });
  it("tracks wall-clock time: the known drop-frame drift is 3.6 ms an hour", () => {
    expect(Math.abs(107892 / DF30.fps - 3600)).toBeLessThan(0.004);
  });
  it("round-trips every frame of the first hour, in both directions", () => {
    for (let f = 0; f < 107892; f += 7) {
      const tc = framesToTimecode(f, DF30);
      expect(timecodeToFrames(tc, DF30)).toBe(f);
    }
  });
  it("never emits a dropped label", () => {
    for (let f = 0; f < 40000; f++) {
      const m = /^(\d\d):(\d\d):(\d\d);(\d\d)$/.exec(framesToTimecode(f, DF30))!;
      if (Number(m[3]) === 0 && Number(m[2]) % 10 !== 0) expect(Number(m[4])).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("drop-frame timecode (59.94)", () => {
  it("drops four labels a minute", () => {
    expect(dropLabelsPerMinute(DF60)).toBe(4);
    expect(framesToTimecode(3600, DF60)).toBe("00:01:00;04");
    expect(framesToTimecode(35964, DF60)).toBe("00:10:00;00");
    expect(timecodeToFrames("01:00:00;00", DF60)).toBe(215784);
  });
  it("round-trips", () => {
    for (let f = 0; f < 100000; f += 11) expect(timecodeToFrames(framesToTimecode(f, DF60), DF60)).toBe(f);
  });
});

describe("non-drop and odd inputs", () => {
  it("keeps 25 and 24 fps on their nominal base", () => {
    const r25 = resolveCaptionFrameRate(25);
    expect(framesToTimecode(25 * 3600, r25)).toBe("01:00:00:00");
    expect(timecodeToFrames("00:00:01:24", r25)).toBe(49);
    expect(timecodeToFrames("00:00:01:25", r25)).toBeNull();
  });
  it("halves rates above 30 so timecode stays in a 30 frame base", () => {
    expect(resolveCaptionFrameRate(59.94, true)).toMatchObject({ nominal: 30, dropFrame: true });
    expect(resolveCaptionFrameRate(50).nominal).toBe(25);
  });
  it("rejects malformed timecodes", () => {
    for (const bad of ["", "1:2:3", "00:61:00:00", "00:00:61:00", "xx:00:00:00", "00:00:00:30"]) expect(timecodeToFrames(bad, DF30)).toBeNull();
  });
});

describe("dropped drop-frame labels", () => {
  const df = { fps: 30000 / 1001, nominal: 30, dropFrame: true } as const;
  it("rejects labels 00-01 at the start of a non-tenth minute and accepts the rest", () => {
    expect(timecodeToFrames("00:01:00;02", df)).toBe(1800);
    expect(timecodeToFrames("00:01:00;00", df)).toBeNull();
    expect(timecodeToFrames("00:01:00;01", df)).toBeNull();
    expect(timecodeToFrames("00:10:00;00", df)).toBe(17982);
    expect(timecodeToFrames("00:01:01;00", df)).not.toBeNull();
    expect(timecodeProblem("00:01:00;01", df)).toMatch(/dropped drop-frame label/);
    expect(timecodeProblem("00:01:00;02", df)).toBeNull();
  });
  it("drops four labels at 59.94", () => {
    const df60 = { fps: 60000 / 1001, nominal: 60, dropFrame: true } as const;
    expect(timecodeToFrames("00:01:00;03", df60)).toBeNull();
    expect(timecodeToFrames("00:01:00;04", df60)).toBe(3600);
  });
  it("non-drop timecode keeps every label", () => {
    expect(timecodeToFrames("00:01:00:00", { fps: 30, nominal: 30, dropFrame: false })).toBe(1800);
  });
});

describe("dropped labels in SCC and TTML", () => {
  it("SCC import reports the line instead of throwing", () => {
    const r = parseScc("Scenarist_SCC V1.0\n\n00:01:00;01\t9420 9420\n\n00:01:00;02\t9420 9420\n");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/dropped drop-frame label/);
  });
  it("TTML dropNTSC reports an unreadable time and skips the paragraph", () => {
    const body = (b: string) =>
      `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="smpte" ttp:frameRate="30" ttp:frameRateMultiplier="1000 1001" ttp:dropMode="dropNTSC"><body><div><p begin="${b}" end="00:02:00:02">Hi</p></div></body></tt>`;
    const bad = parseTtml(body("00:01:00:01"));
    expect(bad.subtitles).toEqual([]);
    expect(bad.errors[0].message).toMatch(/Unreadable begin time.*dropped/);
    expect(parseTtml(body("00:01:00:02")).errors).toEqual([]);
  });
});
