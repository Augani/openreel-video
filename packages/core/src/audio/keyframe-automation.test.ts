import { describe, it, expect } from "vitest";
import { keyframesToAutomation } from "./keyframe-automation";
import type { Keyframe } from "../types/timeline";

const kf = (property: string, time: number, value: number): Keyframe => ({ id:`${property}-${time}`, property, time, value, easing:"linear" });

describe("keyframesToAutomation", () => {
  it("maps audio.volume keyframes to sorted automation points", () => {
    const pts = keyframesToAutomation([kf("audio.volume",2,0.5), kf("audio.volume",0,1), kf("transform.opacity",1,0.2)], "audio.volume");
    expect(pts).toEqual([{ time:0, value:1 }, { time:2, value:0.5 }]);
  });
  it("returns [] when none match", () => {
    expect(keyframesToAutomation([], "audio.volume")).toEqual([]);
    expect(keyframesToAutomation([kf("audio.pan",0,0)], "audio.volume")).toEqual([]);
  });
});
