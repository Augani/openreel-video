#!/usr/bin/env python3
"""Writes the hand-made OCIO test config and its LUT files into packages/core/src/color/ocio/fixtures/handmade/.
The config exercises every transform kind the runtime evaluates: matrix, exponent (all negative styles),
exponent-with-linear, log affine / camera (with break), CDL (asc and noclamp), range, fixed functions, 1D / 3D LUTs
(.cube, .spi1d, .spi3d, .csp), looks, a view transform and views.  Run: python scripts/ocio/make-handmade.py"""
import math
import os
import sys

import numpy as np

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "core", "src", "color", "ocio", "fixtures", "handmade")
LUTS = os.path.join(OUT, "luts")


def fmt(v):
    return "%.7f" % v


def film_twist(r, g, b):
    # A deliberately non-linear colour change so interpolation differences show.
    r2 = r ** 0.8 + 0.12 * g * b - 0.05 * g
    g2 = g ** 1.1 + 0.08 * r * r - 0.03 * b
    b2 = b ** 0.9 + 0.1 * math.sin(3.0 * r) * 0.2
    return r2, g2, b2


def write_cube3d(path, size):
    with open(path, "w") as f:
        f.write('TITLE "film twist"\nLUT_3D_SIZE %d\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n' % size)
        for b in range(size):
            for g in range(size):
                for r in range(size):
                    o = film_twist(r / (size - 1), g / (size - 1), b / (size - 1))
                    f.write("%s %s %s\n" % tuple(fmt(x) for x in o))


def write_cube1d(path, size):
    lo, hi = -0.1, 2.0
    with open(path, "w") as f:
        f.write("TITLE shaper\nLUT_1D_SIZE %d\nDOMAIN_MIN %s %s %s\nDOMAIN_MAX %s %s %s\n" % (size, lo, lo, lo, hi, hi, hi))
        for i in range(size):
            t = i / (size - 1)
            x = lo + t * (hi - lo)
            y = math.log2(max(x, 0) + 0.02) * 0.1 + 0.5
            f.write("%s %s %s\n" % (fmt(y), fmt(y * 0.95 + 0.01), fmt(math.sqrt(max(t, 0)))))


def write_spi1d(path, size):
    with open(path, "w") as f:
        f.write("Version 1\nFrom -0.2 1.5\nLength %d\nComponents 3\n{\n" % size)
        for i in range(size):
            t = i / (size - 1)
            f.write("  %s %s %s\n" % (fmt(t ** 0.7), fmt(t ** 0.5 * 0.98), fmt(t * t * 0.9 + 0.05 * t)))
        f.write("}\n")


def write_spi1d_mono(path, size):
    with open(path, "w") as f:
        f.write("Version 1\nFrom 0.0 1.0\nLength %d\nComponents 1\n{\n" % size)
        for i in range(size):
            t = i / (size - 1)
            f.write("  %s\n" % fmt(t ** 2.2))
        f.write("}\n")


def write_spi3d(path, size):
    with open(path, "w") as f:
        f.write("SPILUT 1.0\n3 3\n%d %d %d\n" % (size, size, size))
        for r in range(size):
            for g in range(size):
                for b in range(size):
                    o = film_twist(r / (size - 1), g / (size - 1), b / (size - 1))
                    f.write("%d %d %d %s %s %s\n" % (r, g, b, fmt(o[0]), fmt(o[1]), fmt(o[2])))


def write_csp(path, size, curved=False):
    # Pre-LUT points per channel (a straight 0..2 -> 0..1 range map, or a curve), then a 3D table (red fastest, as .cube).
    if curved:
        pts_in = [0.0, 0.05, 0.2, 0.5, 1.0, 2.0, 4.0]
        pts_out = [0.0, 0.15, 0.4, 0.6, 0.8, 0.93, 1.0]
    else:
        pts_in = [0.0, 0.5, 1.5, 2.0]
        pts_out = [0.0, 0.25, 0.75, 1.0]
    with open(path, "w") as f:
        f.write("CSPLUTV100\n3D\n\nBEGIN METADATA\nEND METADATA\n\n")
        for _ in range(3):
            f.write("%d\n%s\n%s\n" % (len(pts_in), " ".join(str(x) for x in pts_in), " ".join(str(x) for x in pts_out)))
        f.write("\n%d %d %d\n" % (size, size, size))
        for b in range(size):
            for g in range(size):
                for r in range(size):
                    o = film_twist(r / (size - 1), g / (size - 1), b / (size - 1))
                    f.write("%s %s %s\n" % tuple(fmt(x) for x in o))


CONFIG = """ocio_profile_version: 2.1

environment:
  LUT_DIR: luts

search_path: $LUT_DIR
strictparsing: true
luma: [0.2126, 0.7152, 0.0722]
name: openreel-handmade
description: Hand-made test config for the OpenReel OCIO runtime.

roles:
  scene_linear: Linear
  reference: Linear
  default: Gamma 2.2
  data: Raw
  color_picking: Gamma 2.2

file_rules:
  - !<Rule> {name: Default, colorspace: Gamma 2.2}

displays:
  Test Display:
    - !<View> {name: Standard, view_transform: Simple Tone, display_colorspace: Display Gamma 2.4}
    - !<View> {name: Film, view_transform: Simple Tone, display_colorspace: Display Gamma 2.4, looks: Film Print}
    - !<View> {name: Raw, colorspace: Raw}
    - !<View> {name: Gamma Only, colorspace: Gamma 2.2}

active_displays: [Test Display]
active_views: [Standard, Film, Raw, Gamma Only]

default_view_transform: Simple Tone

view_transforms:
  - !<ViewTransform>
    name: Simple Tone
    from_scene_reference: !<GroupTransform>
      children:
        - !<MatrixTransform> {matrix: [0.9, 0.05, 0.05, 0, 0.02, 0.95, 0.03, 0, 0.01, 0.04, 0.95, 0, 0, 0, 0, 1]}
        - !<ExponentWithLinearTransform> {gamma: 2.4, offset: 0.055, direction: inverse}
        - !<ExponentWithLinearTransform> {gamma: 2.4, offset: 0.055}

looks:
  - !<Look>
    name: Warm CDL
    process_space: Linear
    transform: !<CDLTransform> {slope: [1.1, 1.0, 0.9], offset: [0.01, 0.0, -0.01], power: [0.95, 1.0, 1.05], sat: 1.2}
  - !<Look>
    name: Noclamp CDL
    process_space: Linear
    transform: !<CDLTransform> {slope: [1.2, 0.9, 1.0], offset: [-0.02, 0.01, 0.0], power: [1.1, 0.9, 1.0], sat: 0.8, style: noclamp}
  - !<Look>
    name: Film Print
    process_space: Log Camera
    transform: !<FileTransform> {src: film_twist.cube, interpolation: linear}
  - !<Look>
    name: Film Tetra
    process_space: Log Camera
    transform: !<FileTransform> {src: film_twist.spi3d, interpolation: tetrahedral}
  - !<Look>
    name: Inverse Only
    process_space: Linear
    inverse_transform: !<CDLTransform> {slope: [1.3, 1.0, 0.8], offset: [0.0, 0.02, 0.0], power: [1.0, 1.1, 1.0], sat: 1.1}
  - !<Look>
    name: CSP Look
    process_space: Linear
    transform: !<FileTransform> {src: film_twist.csp}

display_colorspaces:
  - !<ColorSpace>
    name: Display Gamma 2.4
    family: Display
    from_display_reference: !<ExponentTransform> {value: 2.4, direction: inverse, style: mirror}

  - !<ColorSpace>
    name: Display Clamp Matrix
    from_display_reference: !<GroupTransform>
      children:
        - !<MatrixTransform> {matrix: [1.05, -0.02, -0.03, 0, -0.01, 1.04, -0.03, 0, 0.0, -0.02, 1.02, 0, 0, 0, 0, 1]}
        - !<RangeTransform> {min_in_value: 0, max_in_value: 1, min_out_value: 0, max_out_value: 1}

colorspaces:
  - !<ColorSpace>
    name: Linear
    family: Scene
    isdata: false
    description: Scene-linear reference.
    encoding: scene-linear

  - !<ColorSpace>
    name: Raw
    family: Data
    isdata: true

  - !<ColorSpace>
    name: Gamma 2.2
    aliases: [g22]
    family: Display
    to_scene_reference: !<ExponentTransform> {value: 2.2, style: pass_thru}

  - !<ColorSpace>
    name: Gamma 1.8 Mirror
    to_scene_reference: !<ExponentTransform> {value: [1.8, 1.9, 2.0, 1], style: mirror}

  - !<ColorSpace>
    name: Gamma Clamp
    from_scene_reference: !<ExponentTransform> {value: 2.4, direction: inverse}

  - !<ColorSpace>
    name: sRGB Curve
    to_scene_reference: !<ExponentWithLinearTransform> {gamma: 2.4, offset: 0.055}

  - !<ColorSpace>
    name: Rec709 Curve Mirror
    from_scene_reference: !<ExponentWithLinearTransform> {gamma: 2.2222222222, offset: 0.099, style: mirror}

  - !<ColorSpace>
    name: Log Camera
    to_scene_reference: !<GroupTransform>
      children:
        - !<LogCameraTransform> {base: 10, log_side_slope: 0.2471896, log_side_offset: 0.3855369, lin_side_slope: 5.5555556, lin_side_offset: 0.0522722, lin_side_break: 0.0105909, direction: inverse}
        - !<MatrixTransform> {matrix: [0.7, 0.2, 0.1, 0, 0.05, 0.9, 0.05, 0, 0.0, 0.1, 0.9, 0, 0, 0, 0, 1]}

  - !<ColorSpace>
    name: Log Camera Explicit Slope
    to_scene_reference: !<LogCameraTransform> {base: 2, log_side_slope: [0.06, 0.065, 0.07], log_side_offset: [-0.29, -0.3, -0.31], lin_side_slope: 2231.8, lin_side_offset: 64, lin_side_break: -0.018, linear_slope: [30, 31, 32], direction: inverse}

  - !<ColorSpace>
    name: Log Affine
    to_scene_reference: !<LogAffineTransform> {base: 2.71828182845905, log_side_slope: 0.0869, log_side_offset: 0.53, lin_side_slope: 1.1, lin_side_offset: 0.0055, direction: inverse}

  - !<ColorSpace>
    name: Log10 Pure
    from_scene_reference: !<LogTransform> {base: 10}

  - !<ColorSpace>
    name: Legal Range
    to_scene_reference: !<GroupTransform>
      children:
        - !<RangeTransform> {min_in_value: 0.0627, max_in_value: 0.9214, min_out_value: 0, max_out_value: 1}
        - !<ExponentTransform> {value: 2.0}

  - !<ColorSpace>
    name: Half Range
    to_scene_reference: !<RangeTransform> {min_in_value: 0, max_in_value: 0.5, min_out_value: 0, max_out_value: 4, style: noclamp}

  - !<ColorSpace>
    name: Lower Clamp
    to_scene_reference: !<RangeTransform> {min_in_value: 0.1, min_out_value: 0.1}

  - !<ColorSpace>
    name: Film Scan Cube
    to_scene_reference: !<FileTransform> {src: film_twist.cube, interpolation: linear}

  - !<ColorSpace>
    name: Film Scan Cube Tetra
    to_scene_reference: !<FileTransform> {src: film_twist.cube, interpolation: tetrahedral}

  - !<ColorSpace>
    name: Film Scan SPI Best
    to_scene_reference: !<FileTransform> {src: film_twist.spi3d, interpolation: best}

  - !<ColorSpace>
    name: Film Scan SPI Default
    to_scene_reference: !<FileTransform> {src: film_twist.spi3d}

  - !<ColorSpace>
    name: Shaper Cube1D
    to_scene_reference: !<FileTransform> {src: shaper.cube}

  - !<ColorSpace>
    name: Shaper Cube1D Inverse
    from_scene_reference: !<FileTransform> {src: shaper.cube}

  - !<ColorSpace>
    name: Curve SPI1D
    to_scene_reference: !<FileTransform> {src: curve.spi1d}

  - !<ColorSpace>
    name: Curve SPI1D Mono
    to_scene_reference: !<FileTransform> {src: mono.spi1d, direction: inverse}

  - !<ColorSpace>
    name: Cinespace
    to_scene_reference: !<FileTransform> {src: film_twist.csp}

  - !<ColorSpace>
    name: Cinespace Curved Prelut
    to_scene_reference: !<FileTransform> {src: film_twist_curved.csp}

  - !<ColorSpace>
    name: ACES Fixed Functions
    to_scene_reference: !<GroupTransform>
      children:
        - !<FixedFunctionTransform> {style: ACES_Glow03}
        - !<FixedFunctionTransform> {style: ACES_RedMod10}
        - !<FixedFunctionTransform> {style: ACES_Glow10}
        - !<FixedFunctionTransform> {style: ACES_DarkToDim10}

  - !<ColorSpace>
    name: ACES Fixed Functions Inverse
    from_scene_reference: !<GroupTransform>
      children:
        - !<FixedFunctionTransform> {style: ACES_Glow03}
        - !<FixedFunctionTransform> {style: ACES_RedMod10}
        - !<FixedFunctionTransform> {style: ACES_Glow10}
        - !<FixedFunctionTransform> {style: ACES_DarkToDim10}

  - !<ColorSpace>
    name: FF RedMod10
    to_scene_reference: !<FixedFunctionTransform> {style: ACES_RedMod10}

  - !<ColorSpace>
    name: FF Glow03
    to_scene_reference: !<FixedFunctionTransform> {style: ACES_Glow03}

  - !<ColorSpace>
    name: FF Glow10
    to_scene_reference: !<FixedFunctionTransform> {style: ACES_Glow10}

  - !<ColorSpace>
    name: FF DarkToDim
    to_scene_reference: !<FixedFunctionTransform> {style: ACES_DarkToDim10}

  - !<ColorSpace>
    name: Surround
    to_scene_reference: !<FixedFunctionTransform> {style: REC2100_Surround, params: [0.8333333333]}

  - !<ColorSpace>
    name: XYZ To xyY
    to_scene_reference: !<FixedFunctionTransform> {style: XYZ_TO_xyY}

  - !<ColorSpace>
    name: XYZ To uvY
    to_scene_reference: !<FixedFunctionTransform> {style: XYZ_TO_uvY}

  - !<ColorSpace>
    name: XYZ To LUV
    to_scene_reference: !<FixedFunctionTransform> {style: XYZ_TO_LUV}

  - !<ColorSpace>
    name: RGB To HSV
    to_scene_reference: !<FixedFunctionTransform> {style: RGB_TO_HSV}

  - !<ColorSpace>
    name: Gamut Comp
    to_scene_reference: !<FixedFunctionTransform> {style: ACES_GamutComp13, params: [1.147, 1.264, 1.312, 0.815, 0.803, 0.88, 1.2]}

  - !<ColorSpace>
    name: ACEScct Builtin
    to_scene_reference: !<BuiltinTransform> {style: ACEScct_to_ACES2065-1}

  - !<ColorSpace>
    name: Nested Colorspace Transform
    to_scene_reference: !<GroupTransform>
      children:
        - !<ColorSpaceTransform> {src: Gamma 2.2, dst: Linear}
        - !<MatrixTransform> {offset: [0.01, 0.02, 0.03, 0]}

  - !<ColorSpace>
    name: FF RedMod03 Unsupported
    to_scene_reference: !<FixedFunctionTransform> {style: ACES_RedMod03}

  - !<ColorSpace>
    name: Needs Missing LUT
    to_scene_reference: !<FileTransform> {src: not_provided.cube}

  - !<ColorSpace>
    name: Uses Grading
    to_scene_reference: !<ExposureContrastTransform> {exposure: 1}

"""


def main():
    os.makedirs(LUTS, exist_ok=True)
    with open(os.path.join(OUT, "config.ocio"), "w") as f:
        f.write(CONFIG)
    write_cube3d(os.path.join(LUTS, "film_twist.cube"), 17)
    write_cube1d(os.path.join(LUTS, "shaper.cube"), 64)
    write_spi1d(os.path.join(LUTS, "curve.spi1d"), 48)
    write_spi1d_mono(os.path.join(LUTS, "mono.spi1d"), 40)
    write_spi3d(os.path.join(LUTS, "film_twist.spi3d"), 9)
    write_csp(os.path.join(LUTS, "film_twist.csp"), 9)
    write_csp(os.path.join(LUTS, "film_twist_curved.csp"), 9, curved=True)
    print("wrote", OUT, file=sys.stderr)


if __name__ == "__main__":
    main()
