import { describe, expect, it } from "vitest";
import { clipNameKey, compileProxyPattern, explainProxyMismatch, matchProxiesByPattern } from "./proxy-attach";
import type { RelinkCandidate, RelinkTarget } from "./desktop-ingest";

const target = (id: string, name: string, duration = 10, frameRate = 25): RelinkTarget => ({ id, type: "video", name, duration, frameRate });
const file = (name: string, duration: number | undefined, frameRate = 25, dir = "/proxies"): RelinkCandidate => ({ path: `${dir}/${name}`, name, duration, frameRate, width: 960, height: 540 });

describe("proxy name patterns", () => {
  it("compiles {name} templates and extracts the clip name", () => {
    const p = compileProxyPattern("{name}_proxy");
    expect(p.keyOf("A001C002.mov")).toBeNull();
    expect(p.keyOf("A001C002_proxy.mp4")).toBe("a001c002");
    expect(p.keyOf("A001C002_PROXY.MP4")).toBe("a001c002");
    expect(compileProxyPattern("{name}").keyOf("clip.mov")).toBe("clip");
    expect(compileProxyPattern("prx_{name}-lr").keyOf("PRX_clip 1-LR.mp4")).toBe("clip 1");
    expect(compileProxyPattern("{name}_proxy").keyOf("_proxy.mov")).toBeNull();
  });
  it("ignores the H.264 preview twin suffix", () => {
    expect(compileProxyPattern("{name}_proxy").keyOf("a_proxy.preview.mp4")).toBe("a");
  });
  it("rejects templates without exactly one {name}, and paths", () => {
    expect(() => compileProxyPattern("_proxy")).toThrow(/exactly one/);
    expect(() => compileProxyPattern("{name}{name}")).toThrow(/exactly one/);
    expect(() => compileProxyPattern("a/{name}")).toThrow(/not a path/);
  });
  it("normalises the original clip's name", () => {
    expect(clipNameKey("/cards/A001.MOV")).toBe("a001");
  });
});

describe("explaining a mismatch", () => {
  it("is empty for a fit, names duration and frame rate otherwise, and refuses an unprobed file", () => {
    expect(explainProxyMismatch(target("a", "a.mov"), file("a_proxy.mp4", 10.1))).toEqual([]);
    expect(explainProxyMismatch(target("a", "a.mov"), file("a_proxy.mp4", 14))[0]).toMatch(/Duration 14\.00s does not match the original 10\.00s/);
    expect(explainProxyMismatch(target("a", "a.mov"), file("a_proxy.mp4", 10, 30))[0]).toMatch(/Frame rate 30\.000 fps does not match the original 25\.000 fps/);
    expect(explainProxyMismatch(target("a", "a.mov"), file("a_proxy.mp4", 14, 30))).toHaveLength(2);
    expect(explainProxyMismatch(target("a", "a.mov"), file("a_proxy.mp4", undefined))[0]).toMatch(/could not be read/);
  });
});

describe("attaching proxies by name, duration and frame rate", () => {
  const targets = [target("a", "A001.mov"), target("b", "B002.mov", 20, 29.97), target("c", "C003.mov"), target("d", "D004.mov")];
  it("attaches the files that fit by the default suffixes", () => {
    const r = matchProxiesByPattern(targets, [file("A001_proxy.mp4", 10), file("B002-prx.mov", 20, 29.97)]);
    expect(r.matches.map((m) => [m.mediaId, m.candidate.name])).toEqual([["a", "A001_proxy.mp4"], ["b", "B002-prx.mov"]]);
    expect(r.mismatches).toEqual([]);
    expect(r.unmatchedMediaIds).toEqual(["c", "d"]);
  });
  it("reports a wrong duration or frame rate as a mismatch with reasons, and never attaches it", () => {
    const r = matchProxiesByPattern(targets, [file("A001_proxy.mp4", 12), file("B002_proxy.mp4", 20, 25), file("C003_proxy.mp4", undefined)]);
    expect(r.matches).toEqual([]);
    expect(r.mismatches.map((m) => [m.mediaId, m.reasons.length])).toEqual([["a", 1], ["b", 1], ["c", 1]]);
    expect(r.mismatches[0].reasons[0]).toMatch(/Duration/);
    expect(r.mismatches[1].reasons[0]).toMatch(/Frame rate/);
    expect(r.unmatchedMediaIds).toEqual(["d"]);
    // Files that were reported are not "unused".
    expect(r.unusedCandidates).toEqual([]);
  });
  it("uses a custom pattern, and ignores files that do not follow it", () => {
    const pattern = compileProxyPattern("{name}_LR");
    const r = matchProxiesByPattern(targets, [file("A001_LR.mp4", 10), file("B002_proxy.mp4", 20, 29.97)], pattern);
    expect(r.matches.map((m) => m.mediaId)).toEqual(["a"]);
    expect(r.unusedCandidates.map((c) => c.name)).toEqual(["B002_proxy.mp4"]);
    expect(r.unmatchedMediaIds).toEqual(["b", "c", "d"]);
  });
  it("matches same-name proxies in another folder with the {name} pattern", () => {
    const r = matchProxiesByPattern([target("a", "A001.mov")], [file("A001.mov", 10, 25, "/proxy-card")], compileProxyPattern("{name}"));
    expect(r.matches).toHaveLength(1);
  });
  it("picks the file that fits when another with the same name does not", () => {
    const r = matchProxiesByPattern([target("a", "A001.mov")], [file("A001_proxy.mp4", 30, 25, "/old"), file("A001_proxy.mp4", 10, 25, "/new")]);
    expect(r.matches.map((m) => m.candidate.path)).toEqual(["/new/A001_proxy.mp4"]);
  });
  it("reports two equally good files as ambiguous, and one file claimed by two clips", () => {
    const two = matchProxiesByPattern([target("a", "A001.mov")], [file("A001_proxy.mp4", 10, 25, "/x"), file("A001_proxy.mp4", 10, 25, "/y")]);
    expect(two.matches).toEqual([]);
    expect(two.ambiguous).toHaveLength(1);
    expect(two.ambiguous[0].candidates).toHaveLength(2);
    const claimed = matchProxiesByPattern([target("a", "A001.mov"), target("b", "A001.mov")], [file("A001_proxy.mp4", 10)]);
    expect(claimed.matches.map((m) => m.mediaId)).toEqual(["a"]);
    expect(claimed.ambiguous.map((x) => x.mediaId)).toEqual(["b"]);
  });
  it("recognises this app's own proxy names for every preset naming", () => {
    const r = matchProxiesByPattern([target("a", "Interview A.mov")], [file("Interview A-abcdef12_w1280-lt-bn-tc-na_proxy.mov", 10)]);
    expect(r.matches).toHaveLength(1);
  });
  it("skips duration checks for stills", () => {
    const still: RelinkTarget = { id: "s", type: "image", name: "s.png", duration: 0, frameRate: 0 };
    expect(matchProxiesByPattern([still], [{ path: "/p/s_proxy.png", name: "s_proxy.png" }]).matches).toHaveLength(1);
  });
});
