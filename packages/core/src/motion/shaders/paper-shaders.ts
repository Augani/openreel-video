// Adapted from @paper-design/shaders (https://github.com/paper-design/shaders), Apache-2.0.
import {
  ShaderFitOptions,
  defaultObjectSizing,
  defaultPatternSizing,
  colorPanelsFragmentShader,
  ditheringFragmentShader,
  dotGridFragmentShader,
  dotOrbitFragmentShader,
  flutedGlassFragmentShader,
  gemSmokeFragmentShader,
  godRaysFragmentShader,
  grainGradientFragmentShader,
  halftoneCmykFragmentShader,
  halftoneDotsFragmentShader,
  heatmapFragmentShader,
  imageDitheringFragmentShader,
  liquidMetalFragmentShader,
  meshGradientFragmentShader,
  metaballsFragmentShader,
  neuroNoiseFragmentShader,
  paperTextureFragmentShader,
  perlinNoiseFragmentShader,
  pulsingBorderFragmentShader,
  simplexNoiseFragmentShader,
  smokeRingFragmentShader,
  spiralFragmentShader,
  staticMeshGradientFragmentShader,
  staticRadialGradientFragmentShader,
  swirlFragmentShader,
  voronoiFragmentShader,
  warpFragmentShader,
  waterFragmentShader,
  wavesFragmentShader,
} from "@paper-design/shaders";
import type { MotionShaderColorArrayParams, MotionShaderDef, MotionShaderParamDef } from "./types";

export const PAPER_VERTEX_SHADER = `#version 300 es
precision mediump float;

layout(location = 0) in vec4 a_position;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_imageAspectRatio;
uniform float u_originX;
uniform float u_originY;
uniform float u_worldWidth;
uniform float u_worldHeight;
uniform float u_fit;
uniform float u_scale;
uniform float u_rotation;
uniform float u_offsetX;
uniform float u_offsetY;

out vec2 v_objectUV;
out vec2 v_objectBoxSize;
out vec2 v_responsiveUV;
out vec2 v_responsiveBoxGivenSize;
out vec2 v_patternUV;
out vec2 v_patternBoxSize;
out vec2 v_imageUV;

vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {
  vec2 box = vec2(0.);
  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);
  float noFitBoxWidth = box.x;
  if (u_fit == 1.) {
    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);
  } else if (u_fit == 2.) {
    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);
  }
  box.y = box.x / boxRatio;
  return vec3(box, noFitBoxWidth);
}

void main() {
  gl_Position = a_position;

  vec2 uv = gl_Position.xy * .5;
  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);
  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);
  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;
  float r = u_rotation * 3.14159265358979323846 / 180.;
  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));
  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);

  float fixedRatio = 1.;
  vec2 fixedRatioBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );

  v_objectBoxSize = getBoxSize(fixedRatio, fixedRatioBoxGivenSize).xy;
  vec2 objectWorldScale = u_resolution.xy / v_objectBoxSize;

  v_objectUV = uv;
  v_objectUV *= objectWorldScale;
  v_objectUV += boxOrigin * (objectWorldScale - 1.);
  v_objectUV += graphicOffset;
  v_objectUV /= u_scale;
  v_objectUV = graphicRotation * v_objectUV;

  v_responsiveBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  float responsiveRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
  vec2 responsiveBoxSize = getBoxSize(responsiveRatio, v_responsiveBoxGivenSize).xy;
  vec2 responsiveBoxScale = u_resolution.xy / responsiveBoxSize;

  #ifdef ADD_HELPERS
  v_responsiveHelperBox = uv;
  v_responsiveHelperBox *= responsiveBoxScale;
  v_responsiveHelperBox += boxOrigin * (responsiveBoxScale - 1.);
  #endif

  v_responsiveUV = uv;
  v_responsiveUV *= responsiveBoxScale;
  v_responsiveUV += boxOrigin * (responsiveBoxScale - 1.);
  v_responsiveUV += graphicOffset;
  v_responsiveUV /= u_scale;
  v_responsiveUV.x *= responsiveRatio;
  v_responsiveUV = graphicRotation * v_responsiveUV;
  v_responsiveUV.x /= responsiveRatio;

  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;
  vec2 patternBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  patternBoxRatio = patternBoxGivenSize.x / patternBoxGivenSize.y;

  vec3 boxSizeData = getBoxSize(patternBoxRatio, patternBoxGivenSize);
  v_patternBoxSize = boxSizeData.xy;
  float patternBoxNoFitBoxWidth = boxSizeData.z;
  vec2 patternBoxScale = u_resolution.xy / v_patternBoxSize;

  v_patternUV = uv;
  v_patternUV += graphicOffset / patternBoxScale;
  v_patternUV += boxOrigin;
  v_patternUV -= boxOrigin / patternBoxScale;
  v_patternUV *= u_resolution.xy;
  v_patternUV /= u_pixelRatio;
  if (u_fit > 0.) {
    v_patternUV *= (patternBoxNoFitBoxWidth / v_patternBoxSize.x);
  }
  v_patternUV /= u_scale;
  v_patternUV = graphicRotation * v_patternUV;
  v_patternUV += boxOrigin / patternBoxScale;
  v_patternUV -= boxOrigin;
  v_patternUV *= .01;

  vec2 imageBoxSize;
  if (u_fit == 1.) {
    imageBoxSize.x = min(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else if (u_fit == 2.) {
    imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else {
    imageBoxSize.x = min(10.0, 10.0 / u_imageAspectRatio * u_imageAspectRatio);
  }
  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;
  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;

  v_imageUV = uv;
  v_imageUV *= imageBoxScale;
  v_imageUV += boxOrigin * (imageBoxScale - 1.);
  v_imageUV += graphicOffset;
  v_imageUV /= u_scale;
  v_imageUV.x *= u_imageAspectRatio;
  v_imageUV = graphicRotation * v_imageUV;
  v_imageUV.x /= u_imageAspectRatio;

  v_imageUV += .5;
  v_imageUV.y = 1. - v_imageUV.y;
}
`;

interface Sizing {
  readonly fit: keyof typeof ShaderFitOptions;
  readonly scale: number;
  readonly rotation: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly originX: number;
  readonly originY: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
}

function sizingUniforms(sizing: Sizing, imageAspectRatio: number): Readonly<Record<string, number>> {
  return {
    u_pixelRatio: 1,
    u_imageAspectRatio: imageAspectRatio,
    u_originX: sizing.originX,
    u_originY: sizing.originY,
    u_worldWidth: sizing.worldWidth,
    u_worldHeight: sizing.worldHeight,
    u_fit: ShaderFitOptions[sizing.fit],
    u_scale: sizing.scale,
    u_rotation: sizing.rotation,
    u_offsetX: sizing.offsetX,
    u_offsetY: sizing.offsetY,
  };
}

const PATTERN_STATIC = sizingUniforms(defaultPatternSizing, 1);
const OBJECT_STATIC = sizingUniforms(defaultObjectSizing, 1);
const IMAGE_STATIC: Readonly<Record<string, number>> = {
  ...sizingUniforms(defaultObjectSizing, 1),
  u_isImage: 1,
};

function num(
  name: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
): MotionShaderParamDef {
  return { name, label, type: "number", default: def, min, max, step };
}

function color(name: string, label: string, hex: string): MotionShaderParamDef {
  return { name, label, type: "color", default: hex, min: 0, max: 1, step: 1 };
}

function colors(palette: readonly string[]): readonly MotionShaderParamDef[] {
  return palette.map((hex, index) =>
    color(`color${index + 1}`, `Color ${index + 1}`, hex),
  );
}

function colorArray(uniform: string, countUniform: string, max: number): MotionShaderColorArrayParams {
  return { uniform, countUniform, max };
}

interface PaperEntry {
  readonly id: string;
  readonly name: string;
  readonly category: "fill" | "effect";
  readonly glsl: string;
  readonly staticUniforms: Readonly<Record<string, number>>;
  readonly params: readonly MotionShaderParamDef[];
  readonly colorArrayParams?: MotionShaderColorArrayParams;
  readonly needsNoiseTexture?: string;
  readonly inputUniform?: string;
}

const NOISE = "u_noiseTexture";
const IMAGE = "u_image";
const COLORS = colorArray("u_colors", "u_colorsCount", 10);

const ENTRIES: readonly PaperEntry[] = [
  {
    id: "paper-mesh-gradient",
    name: "Mesh Gradient",
    category: "fill",
    glsl: meshGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#e0eaff", "#241d9a", "#f75092", "#9f50d3"]),
      num("distortion", "Distortion", 0.8, 0, 1, 0.01),
      num("swirl", "Swirl", 0.6, 0, 1, 0.01),
      num("grainOverlay", "Grain", 0, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-static-mesh-gradient",
    name: "Static Mesh Gradient",
    category: "fill",
    glsl: staticMeshGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#ffad0a", "#6200ff", "#e2a3ff", "#ff99fd"]),
      num("positions", "Positions", 3, 0, 8, 0.1),
      num("waveX", "Wave X", 0.5, 0, 1, 0.01),
      num("waveY", "Wave Y", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-static-radial-gradient",
    name: "Static Radial Gradient",
    category: "fill",
    glsl: staticRadialGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#00bbff", "#00ffe1", "#ffffff"]),
      color("colorBack", "Background", "#000000"),
      num("radius", "Radius", 0.5, 0, 2, 0.01),
      num("falloff", "Falloff", 0, -1, 1, 0.01),
      num("mixing", "Mixing", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-smoke-ring",
    name: "Smoke Ring",
    category: "fill",
    glsl: smokeRingFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#ffffff", "#ffca0a", "#fc6203"]),
      color("colorBack", "Background", "#000000"),
      num("radius", "Radius", 0.5, 0, 1, 0.01),
      num("thickness", "Thickness", 0.5, 0, 1, 0.01),
      num("noiseScale", "Noise Scale", 1.6, 0, 4, 0.01),
    ],
  },
  {
    id: "paper-neuro-noise",
    name: "Neuro Noise",
    category: "fill",
    glsl: neuroNoiseFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "Front", "#ffffff"),
      color("colorMid", "Mid", "#47a6ff"),
      color("colorBack", "Background", "#000000"),
      num("brightness", "Brightness", 1.3, 0, 3, 0.01),
      num("contrast", "Contrast", 1, 0, 3, 0.01),
    ],
  },
  {
    id: "paper-metaballs",
    name: "Metaballs",
    category: "fill",
    glsl: metaballsFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 8),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#6e33cc", "#ff5500", "#ffc105"]),
      color("colorBack", "Background", "#000000"),
      num("count", "Count", 6, 1, 8, 1),
      num("size", "Size", 1, 0, 1, 0.01),
      num("sizeRange", "Size Range", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-god-rays",
    name: "God Rays",
    category: "fill",
    glsl: godRaysFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 5),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#a600ff", "#6200ff", "#33fff5"]),
      color("colorBack", "Background", "#000000"),
      num("intensity", "Intensity", 1, 0, 2, 0.01),
      num("density", "Density", 0.4, 0, 1, 0.01),
      num("spotty", "Spotty", 0.3, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-spiral",
    name: "Spiral",
    category: "fill",
    glsl: spiralFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "Front", "#79d1ff"),
      color("colorBack", "Background", "#001429"),
      num("density", "Density", 0.5, 0, 1, 0.01),
      num("distortion", "Distortion", 0.2, 0, 1, 0.01),
      num("strokeWidth", "Stroke Width", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-swirl",
    name: "Swirl",
    category: "fill",
    glsl: swirlFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#ffd1d1", "#ff8a8a", "#660000"]),
      color("colorBack", "Background", "#330000"),
      num("bandCount", "Bands", 4, 1, 12, 1),
      num("twist", "Twist", 0.3, 0, 1, 0.01),
      num("proportion", "Proportion", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-warp",
    name: "Warp",
    category: "fill",
    glsl: warpFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: COLORS,
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#121212", "#9470ff", "#8838ff"]),
      num("proportion", "Proportion", 0.5, 0, 1, 0.01),
      num("distortion", "Distortion", 0.25, 0, 1, 0.01),
      num("swirl", "Swirl", 0.8, 0, 1, 0.01),
      num("softness", "Softness", 1, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-voronoi",
    name: "Voronoi",
    category: "fill",
    glsl: voronoiFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 5),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#ff8247", "#ffe53d", "#83c9fb"]),
      color("colorGap", "Gap", "#2e0000"),
      num("scale", "Zoom", 1, 0.1, 4, 0.01),
      num("distortion", "Distortion", 0.3, 0, 1, 0.01),
      num("gap", "Gap Width", 0.05, 0, 0.5, 0.01),
    ],
  },
  {
    id: "paper-simplex-noise",
    name: "Simplex Noise",
    category: "fill",
    glsl: simplexNoiseFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#4449cf", "#ffd1e0", "#f94446"]),
      num("scale", "Zoom", 1, 0.1, 4, 0.01),
      num("softness", "Softness", 0.5, 0, 1, 0.01),
      num("stepsPerColor", "Steps", 1, 1, 8, 1),
    ],
  },
  {
    id: "paper-perlin-noise",
    name: "Perlin Noise",
    category: "fill",
    glsl: perlinNoiseFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "Front", "#fccff7"),
      color("colorBack", "Background", "#632ad5"),
      num("proportion", "Proportion", 0.5, 0, 1, 0.01),
      num("softness", "Softness", 0.5, 0, 1, 0.01),
      num("octaveCount", "Octaves", 2, 1, 8, 1),
    ],
  },
  {
    id: "paper-grain-gradient",
    name: "Grain Gradient",
    category: "fill",
    glsl: grainGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 7),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#7300ff", "#eba8ff", "#00bfff"]),
      color("colorBack", "Background", "#000000"),
      num("softness", "Softness", 0.5, 0, 1, 0.01),
      num("intensity", "Grain", 0.5, 0, 1, 0.01),
      num("noise", "Noise", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-pulsing-border",
    name: "Pulsing Border",
    category: "fill",
    glsl: pulsingBorderFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 5),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#0dc1fd", "#d915ef", "#ff3f2e"]),
      color("colorBack", "Background", "#000000"),
      num("thickness", "Thickness", 0.1, 0, 1, 0.01),
      num("intensity", "Intensity", 0.5, 0, 1, 0.01),
      num("pulse", "Pulse", 0, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-dot-orbit",
    name: "Dot Orbit",
    category: "fill",
    glsl: dotOrbitFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: COLORS,
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#ffc96b", "#ff6200", "#ff2f00"]),
      color("colorBack", "Background", "#000000"),
      num("size", "Size", 0.5, 0, 1, 0.01),
      num("sizeRange", "Size Range", 0.5, 0, 1, 0.01),
      num("spreading", "Spreading", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-dot-grid",
    name: "Dot Grid",
    category: "fill",
    glsl: dotGridFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFill", "Fill", "#ffffff"),
      color("colorBack", "Background", "#000000"),
      num("dotSize", "Dot Size", 2, 0.5, 20, 0.1),
      num("gapX", "Gap X", 32, 4, 128, 1),
      num("gapY", "Gap Y", 32, 4, 128, 1),
    ],
  },
  {
    id: "paper-waves",
    name: "Waves",
    category: "fill",
    glsl: wavesFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "Front", "#ffbb00"),
      color("colorBack", "Background", "#000000"),
      num("amplitude", "Amplitude", 0.5, 0, 1, 0.01),
      num("frequency", "Frequency", 0.5, 0, 1, 0.01),
      num("spacing", "Spacing", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-color-panels",
    name: "Color Panels",
    category: "fill",
    glsl: colorPanelsFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 7),
    params: [
      ...colors(["#ff9d00", "#fd4f30", "#809bff"]),
      color("colorBack", "Background", "#000000"),
      num("density", "Density", 0.5, 0, 1, 0.01),
      num("angle1", "Angle 1", 0, -1, 1, 0.01),
      num("blur", "Blur", 0.2, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-dithering",
    name: "Dithering",
    category: "fill",
    glsl: ditheringFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "Front", "#00b2ff"),
      color("colorBack", "Background", "#000000"),
      num("pxSize", "Pixel Size", 2, 1, 16, 0.5),
      num("shape", "Shape", 1, 0, 3, 1),
      num("type", "Type", 1, 0, 4, 1),
    ],
  },
  {
    id: "paper-water",
    name: "Water",
    category: "effect",
    glsl: waterFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorHighlight", "Highlight", "#ffffff"),
      num("size", "Size", 0.5, 0, 1, 0.01),
      num("waves", "Waves", 0.5, 0, 1, 0.01),
      num("highlights", "Highlights", 0.5, 0, 1, 0.01),
      num("caustic", "Caustic", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-paper-texture",
    name: "Paper Texture",
    category: "effect",
    glsl: paperTextureFragmentShader,
    staticUniforms: {
      ...IMAGE_STATIC,
      u_contrast: 0.3,
      u_fiberSize: 0.2,
      u_crumpleSize: 0.35,
      u_foldCount: 5,
      u_drops: 0.2,
      u_seed: 5.8,
    },
    inputUniform: IMAGE,
    needsNoiseTexture: NOISE,
    params: [
      color("colorFront", "Texture Color", "#9fadbc"),
      color("colorBack", "Paper Color", "#ffffff"),
      num("roughness", "Roughness", 0.4, 0, 1, 0.01),
      num("crumples", "Crumples", 0.3, 0, 1, 0.01),
      num("folds", "Folds", 0.65, 0, 1, 0.01),
      num("fiber", "Fiber", 0.3, 0, 1, 0.01),
      num("fade", "Fade", 0, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-fluted-glass",
    name: "Fluted Glass",
    category: "effect",
    glsl: flutedGlassFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      num("size", "Size", 0.5, 0, 1, 0.01),
      num("distortion", "Distortion", 0.5, 0, 1, 0.01),
      num("shift", "Shift", 0.5, 0, 1, 0.01),
      num("blur", "Blur", 0.2, 0, 1, 0.01),
      num("highlights", "Highlights", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-image-dithering",
    name: "Image Dithering",
    category: "effect",
    glsl: imageDitheringFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorFront", "Front", "#94ffaf"),
      color("colorBack", "Background", "#000c38"),
      num("pxSize", "Pixel Size", 2, 1, 16, 0.5),
      num("type", "Type", 1, 0, 4, 1),
      num("colorSteps", "Color Steps", 2, 1, 8, 1),
    ],
  },
  {
    id: "paper-halftone-dots",
    name: "Halftone Dots",
    category: "effect",
    glsl: halftoneDotsFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorFront", "Front", "#2b2b2b"),
      color("colorBack", "Background", "#f2f1e8"),
      num("size", "Size", 0.5, 0, 1, 0.01),
      num("radius", "Radius", 0.5, 0, 1, 0.01),
      num("contrast", "Contrast", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-halftone-cmyk",
    name: "Halftone CMYK",
    category: "effect",
    glsl: halftoneCmykFragmentShader,
    staticUniforms: {
      ...IMAGE_STATIC,
      u_type: 1,
      u_grainSize: 0.5,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_gridNoise: 0.2,
      u_floodC: 0.15,
      u_floodM: 0,
      u_floodY: 0,
      u_floodK: 0,
      u_gainC: 0.3,
      u_gainM: 0,
      u_gainY: 0.2,
      u_gainK: 0,
    },
    inputUniform: IMAGE,
    needsNoiseTexture: NOISE,
    params: [
      color("colorBack", "Paper", "#fbfaf5"),
      color("colorC", "Cyan", "#00b4ff"),
      color("colorM", "Magenta", "#fc519f"),
      color("colorY", "Yellow", "#ffd800"),
      color("colorK", "Key", "#231f20"),
      num("size", "Size", 0.2, 0, 1, 0.01),
      num("contrast", "Contrast", 1, 0, 1, 0.01),
      num("softness", "Softness", 1, 0, 1, 0.01),
      num("minDot", "Min Dot", 0.1, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-heatmap",
    name: "Heatmap",
    category: "effect",
    glsl: heatmapFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#11206a", "#6bd7ff", "#ff4c00"]),
      num("contour", "Contour", 0.5, 0, 1, 0.01),
      num("innerGlow", "Inner Glow", 0.5, 0, 1, 0.01),
      num("outerGlow", "Outer Glow", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-liquid-metal",
    name: "Liquid Metal",
    category: "effect",
    glsl: liquidMetalFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorTint", "Tint", "#ffffff"),
      num("repetition", "Repetition", 3, 1, 8, 1),
      num("softness", "Softness", 0.5, 0, 1, 0.01),
      num("shiftRed", "Shift Red", 0.3, 0, 1, 0.01),
      num("distortion", "Distortion", 0.2, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-gem-smoke",
    name: "Gem Smoke",
    category: "effect",
    glsl: gemSmokeFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 6),
    params: [
      ...colors(["#333333", "#e7e6df", "#fafaf5"]),
      num("size", "Size", 0.5, 0, 1, 0.01),
      num("innerGlow", "Inner Glow", 0.5, 0, 1, 0.01),
      num("outerGlow", "Outer Glow", 0.5, 0, 1, 0.01),
    ],
  },
];

export const PAPER_SMOKE_EXCLUSIONS: readonly string[] = [];

const EXCLUDED = new Set(PAPER_SMOKE_EXCLUSIONS);

export const PAPER_SHADER_DEFS: readonly MotionShaderDef[] = ENTRIES.filter(
  (entry) => !EXCLUDED.has(entry.id),
).map((entry) => ({
  id: entry.id,
  name: entry.name,
  category: entry.category,
  glsl: entry.glsl,
  params: entry.params,
  origin: "builtin",
  collection: "Paper",
  vertexShader: PAPER_VERTEX_SHADER,
  staticUniforms: entry.staticUniforms,
  ...(entry.colorArrayParams ? { colorArrayParams: entry.colorArrayParams } : {}),
  ...(entry.needsNoiseTexture ? { needsNoiseTexture: entry.needsNoiseTexture } : {}),
  ...(entry.inputUniform ? { inputUniform: entry.inputUniform } : {}),
}));
