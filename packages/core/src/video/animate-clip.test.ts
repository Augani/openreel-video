import { describe, it, expect } from "vitest";
import { animateTransform, animateEffects } from "./animate-clip";
import type { Clip } from "../types/timeline";

const baseClip = (over: Partial<Clip>): Clip => ({
  id: "c1", mediaId: "m", trackId: "t", startTime: 0, duration: 5, inPoint: 0, outPoint: 5,
  effects: [], audioEffects: [], keyframes: [], volume: 1,
  transform: { position: {x:0,y:0}, scale:{x:1,y:1}, rotation:0, anchor:{x:0.5,y:0.5}, opacity:1, crop:{x:0,y:0,width:1,height:1} },
  ...over,
} as Clip);

describe("animate-clip", () => {
  it("animates crop.width and anchor", () => {
    const clip = baseClip({ keyframes: [
      { id:"a", property:"transform.crop.width", time:0, value:1, easing:"linear" },
      { id:"b", property:"transform.crop.width", time:2, value:0.5, easing:"linear" },
    ]});
    expect(animateTransform(clip, 1).crop!.width).toBeCloseTo(0.75);
  });
  it("supports legacy bare transform names (position.x / opacity)", () => {
    const clip = baseClip({ keyframes: [
      { id:"a", property:"opacity", time:0, value:0, easing:"linear" },
      { id:"b", property:"opacity", time:2, value:1, easing:"linear" },
      { id:"c", property:"position.x", time:0, value:0, easing:"linear" },
      { id:"d", property:"position.x", time:2, value:100, easing:"linear" },
    ]});
    const t = animateTransform(clip, 1);
    expect(t.opacity).toBeCloseTo(0.5);
    expect(t.position.x).toBeCloseTo(50);
  });
  it("animates a specific effect instance by id", () => {
    const clip = baseClip({
      effects: [{ id:"e1", type:"blur", enabled:true, params:{ radius: 0 } }, { id:"e2", type:"blur", enabled:true, params:{ radius: 99 } }],
      keyframes: [ { id:"k1", property:"effect.e1.radius", time:0, value:0, easing:"linear" }, { id:"k2", property:"effect.e1.radius", time:1, value:10, easing:"linear" } ],
    });
    const eff = animateEffects(clip, 1);
    expect(eff.find(e=>e.id==="e1")!.params.radius).toBeCloseTo(10);
    expect(eff.find(e=>e.id==="e2")!.params.radius).toBe(99);
  });
  it("supports legacy effect.<type>", () => {
    const clip = baseClip({ effects:[{id:"e1",type:"brightness",enabled:true,params:{value:0}}],
      keyframes:[{id:"k",property:"effect.brightness",time:0,value:50,easing:"linear"}] });
    expect(animateEffects(clip, 0).find(e=>e.type==="brightness")!.params.value).toBe(50);
  });
});
