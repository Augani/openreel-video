#!/usr/bin/env python3
"""Reference values from real OpenColorIO for the runtime tests (packages/core/src/color/ocio/ocio-runtime.test.ts and
apps/web/e2e/ocio-runtime.spec.ts).

Loads the ACES studio config, the cg config and the hand-made config (fixtures/), builds OCIO processors with
OPTIMIZATION_NONE (so every op is evaluated as written) for colour space conversions, look transforms and display /
view transforms, and writes the results for a fixed set of sample colours to fixtures/ocio-reference.json.

    pip install opencolorio numpy
    python scripts/ocio/make-handmade.py
    python scripts/ocio/make-reference.py
"""
import json
import os
import sys

import numpy as np
import PyOpenColorIO as ocio

FIX = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "core", "src", "color", "ocio", "fixtures")


def samples():
    rng = np.random.default_rng(20241120)
    code = []
    for v in np.linspace(0.0, 1.0, 17):
        code.append([v, v, v])
    code += [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1], [1, 0, 1], [0.18, 0.18, 0.18], [0.5, 0.25, 0.75]]
    code += [[-0.04, 0.2, 0.5], [0.3, -0.02, 1.08], [1.1, 0.9, 1.05]]
    code += rng.random((28, 3)).tolist()
    scene = []
    for v in np.geomspace(0.002, 32.0, 16):
        scene.append([v, v, v])
    scene += [[0, 0, 0], [0.18, 0.18, 0.18], [1, 1, 1], [4, 4, 4], [16, 16, 16]]
    scene += [[2.0, 0.0, 0.0], [0.0, 2.0, 0.0], [0.0, 0.0, 2.0], [1.0, 0.5, 0.0], [0.05, 0.4, 3.0]]
    scene += [[-0.02, 0.1, 0.3], [0.2, -0.05, 0.7], [0.4, 0.3, -0.01]]
    scene += (rng.random((20, 3)) * np.array([2.0, 2.0, 2.0])).tolist()
    return np.array(code, dtype=np.float32), np.array(scene, dtype=np.float32)


def run(proc, arr):
    cpu = proc.getOptimizedProcessor(ocio.OPTIMIZATION_NONE).getDefaultCPUProcessor()
    img = np.ascontiguousarray(arr.copy())
    cpu.applyRGB(img)  # in place, float32 packed RGB
    return img


def flat(a):
    return [float("%.7g" % x) for x in a.reshape(-1)]


def main():
    code, scene = samples()
    cases = []
    skipped = []

    def add(cfgname, cfg, kind, a, b, c, which, build):
        try:
            proc = cfg.getProcessor(build())
            arr = code if which == "code" else scene
            out = run(proc, arr)
        except Exception as e:  # noqa: BLE001
            skipped.append({"cfg": cfgname, "kind": kind, "a": a, "b": b, "c": c, "error": str(e)[:200]})
            return
        cases.append({"cfg": cfgname, "kind": kind, "a": a, "b": b, "c": c, "in": which, "out": flat(out)})

    def cst(cfg, s, d):
        def f():
            t = ocio.ColorSpaceTransform()
            t.setSrc(s)
            t.setDst(d)
            return t
        return f

    def looks(cfg, s, d, l):
        def f():
            t = ocio.LookTransform()
            t.setSrc(s)
            t.setDst(d)
            t.setLooks(l)
            return t
        return f

    def dv(cfg, s, d, v):
        def f():
            t = ocio.DisplayViewTransform()
            t.setSrc(s)
            t.setDisplay(d)
            t.setView(v)
            return t
        return f

    # -- hand-made ---------------------------------------------------------------------------------------------------
    hm_dir = os.path.join(FIX, "handmade")
    cwd = os.getcwd()
    os.chdir(hm_dir)
    hm = ocio.Config.CreateFromFile("config.ocio")
    os.chdir(cwd)
    hm_spaces = [s.getName() for s in hm.getColorSpaces()] + [s.getName() for s in hm.getColorSpaces(ocio.SEARCH_REFERENCE_SPACE_DISPLAY, ocio.COLORSPACE_ALL)]
    hm_spaces = list(dict.fromkeys(hm_spaces))
    for name in hm_spaces:
        if name == "Linear":
            continue
        add("handmade", hm, "cs", name, "Linear", None, "code", cst(hm, name, "Linear"))
        add("handmade", hm, "cs", "Linear", name, None, "scene", cst(hm, "Linear", name))
    for l in ["Warm CDL", "Noclamp CDL", "Film Print", "Film Tetra", "-Warm CDL", "Inverse Only", "-Inverse Only", "CSP Look", "Warm CDL, Film Print", "Warm CDL, -Noclamp CDL", "+Noclamp CDL", "-Noclamp CDL"]:
        add("handmade", hm, "look", "Linear", "Linear", l, "scene", looks(hm, "Linear", "Linear", l))
        add("handmade", hm, "look", "Gamma 2.2", "Gamma 2.2", l, "code", looks(hm, "Gamma 2.2", "Gamma 2.2", l))
    for v in ["Standard", "Film", "Raw", "Gamma Only"]:
        for src in ["Linear", "Log Camera", "Gamma 2.2"]:
            add("handmade", hm, "dv", src, "Test Display", v, "scene" if src == "Linear" else "code", dv(hm, src, "Test Display", v))
    # scene <-> display referred through the default view transform
    add("handmade", hm, "cs", "Linear", "Display Gamma 2.4", None, "scene", cst(hm, "Linear", "Display Gamma 2.4"))

    # -- studio / cg -------------------------------------------------------------------------------------------------
    for cfgname, fname in [("studio", "studio-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio"), ("cg", "cg-config-v2.1.0_aces-v1.3_ocio-v2.3.ocio")]:
        cfg = ocio.Config.CreateFromFile(os.path.join(FIX, fname))
        spaces = [s.getName() for s in cfg.getColorSpaces(ocio.SEARCH_REFERENCE_SPACE_SCENE, ocio.COLORSPACE_ALL)]
        for name in spaces:
            if name == "ACEScg":
                continue
            add(cfgname, cfg, "cs", name, "ACEScg", None, "code", cst(cfg, name, "ACEScg"))
            add(cfgname, cfg, "cs", "ACEScg", name, None, "scene", cst(cfg, "ACEScg", name))
        for display in cfg.getDisplays():
            for view in cfg.getViews(display):
                add(cfgname, cfg, "dv", "ACEScg", display, view, "scene", dv(cfg, "ACEScg", display, view))
        for src in ["ACES2065-1", "sRGB - Texture", "Linear Rec.709 (sRGB)"]:
            try:
                add(cfgname, cfg, "dv", src, "sRGB - Display", "ACES 1.0 - SDR Video", "code" if "Texture" in src else "scene", dv(cfg, src, "sRGB - Display", "ACES 1.0 - SDR Video"))
            except Exception:  # noqa: BLE001
                pass
        # the gamut-compression look from the studio config
        if cfgname == "studio":
            add(cfgname, cfg, "look", "ACEScg", "ACEScg", "ACES 1.3 Reference Gamut Compression", "scene", looks(cfg, "ACEScg", "ACEScg", "ACES 1.3 Reference Gamut Compression"))

    out = {"ocioVersion": ocio.GetVersion(), "inputs": {"code": flat(code), "scene": flat(scene)}, "cases": cases, "skipped": skipped}
    with open(os.path.join(FIX, "ocio-reference.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("cases", len(cases), "skipped", len(skipped), file=sys.stderr)
    for s in skipped:
        print("  skipped", s["cfg"], s["kind"], s["a"], s["b"], s["c"], "-", s["error"][:90], file=sys.stderr)


if __name__ == "__main__":
    main()
