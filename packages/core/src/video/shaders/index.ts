import { displayLayoutWidth, normalizeSequencePar } from "../sequence-par";

export const compositeShaderSource = /* wgsl */ `
struct VertexOutput {
 @builtin(position) position: vec4<f32>,
 @location(0) texCoord: vec2<f32>,
};

struct LayerUniforms {
 opacity: f32,
 padding: vec3<f32>,
};

@group(0) @binding(0) var<uniform> layer: LayerUniforms;
@group(1) @binding(0) var textureSampler: sampler;
@group(1) @binding(1) var layerTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
 var output: VertexOutput;
 let x = f32(i32(vertexIndex & 1u) * 4 - 1);
 let y = f32(i32(vertexIndex >> 1u) * 4 - 1);
 output.position = vec4<f32>(x, y, 0.0, 1.0);
 output.texCoord = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
 return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
 let texColor = textureSample(layerTexture, textureSampler, input.texCoord);
 return vec4<f32>(texColor.rgb, texColor.a * layer.opacity);
}
`;

export const transformShaderSource = /* wgsl */ `
struct VertexOutput {
 @builtin(position) position: vec4<f32>,
 @location(0) texCoord: vec2<f32>,
};

struct TransformUniforms {
 matrix: mat4x4<f32>,
 opacity: f32,
 borderRadius: f32,
 cropX: f32,
 cropY: f32,
 cropWidth: f32,
 cropHeight: f32,
 padding: vec2<f32>,
};

@group(0) @binding(0) var<uniform> transform: TransformUniforms;
@group(1) @binding(0) var textureSampler: sampler;
@group(1) @binding(1) var layerTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
 var output: VertexOutput;
 var positions = array<vec2<f32>, 6>(
 vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
 vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
 );
 var texCoords = array<vec2<f32>, 6>(
 vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
 vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0)
 );
 let pos = positions[vertexIndex];
 output.position = transform.matrix * vec4<f32>(pos, 0.0, 1.0);
 output.texCoord = texCoords[vertexIndex];
 return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
 let croppedUV = vec2<f32>(
 transform.cropX + input.texCoord.x * transform.cropWidth,
 transform.cropY + input.texCoord.y * transform.cropHeight
 );
 let texColor = textureSample(layerTexture, textureSampler, croppedUV);
 return vec4<f32>(texColor.rgb, texColor.a * transform.opacity);
}
`;

export const borderRadiusShaderSource = /* wgsl */ `
struct VertexOutput {
 @builtin(position) position: vec4<f32>,
 @location(0) texCoord: vec2<f32>,
 @location(1) localPos: vec2<f32>,
};

struct BorderRadiusUniforms {
 matrix: mat4x4<f32>,
 opacity: f32,
 radius: f32,
 aspectRatio: f32,
 smoothness: f32,
};

@group(0) @binding(0) var<uniform> uniforms: BorderRadiusUniforms;
@group(1) @binding(0) var textureSampler: sampler;
@group(1) @binding(1) var layerTexture: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
 var output: VertexOutput;
 var positions = array<vec2<f32>, 6>(
 vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
 vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0)
 );
 var texCoords = array<vec2<f32>, 6>(
 vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 0.0),
 vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0), vec2<f32>(1.0, 0.0)
 );
 let pos = positions[vertexIndex];
 output.position = uniforms.matrix * vec4<f32>(pos, 0.0, 1.0);
 output.texCoord = texCoords[vertexIndex];
 output.localPos = pos;
 return output;
}

fn sdRoundedRect(p: vec2<f32>, b: vec2<f32>, r: f32) -> f32 {
 let q = abs(p) - b + vec2<f32>(r);
 return min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0))) - r;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
 let texColor = textureSample(layerTexture, textureSampler, input.texCoord);
 let halfSize = vec2<f32>(1.0, 1.0);
 let clampedRadius = clamp(uniforms.radius, 0.0, 0.5);
 let dist = sdRoundedRect(input.localPos, halfSize, clampedRadius * 2.0);
 let alpha = 1.0 - smoothstep(-uniforms.smoothness, uniforms.smoothness, dist);
 return vec4<f32>(texColor.rgb, texColor.a * uniforms.opacity * alpha);
}
`;

export function createLayerUniformsBuffer(opacity: number): Float32Array {
  const buffer = new Float32Array(8); // 32 bytes aligned
  buffer[0] = opacity;
  // buffer[1-7] are padding
  return buffer;
}

export function createTransformUniformsBuffer(
  matrix: Float32Array,
  opacity: number,
  borderRadius: number,
  crop?: { x: number; y: number; width: number; height: number },
): Float32Array {
  const buffer = new Float32Array(24); // 96 bytes aligned (increased for crop data)
  buffer.set(matrix, 0); // 16 floats for 4x4 matrix
  buffer[16] = opacity;
  buffer[17] = borderRadius;
  // Crop UVs (normalized 0-1)
  buffer[18] = crop?.x ?? 0;
  buffer[19] = crop?.y ?? 0;
  buffer[20] = crop?.width ?? 1;
  buffer[21] = crop?.height ?? 1;
  // buffer[22-23] are padding
  return buffer;
}

/**
 * Clip-space matrix for a layer quad (corners (+-1, +-1), texture (0,0) at the top left), matching what the Canvas2D
 * preview and the export compositor draw:
 *
 *   ctx.scale(1 / par, 1);                              // display -> stored
 *   ctx.translate(L / 2 + x * par, H / 2 + y);          // L = display width = stored width * par
 *   ctx.rotate(rotation); ctx.scale(sx, sy);            // rotation and scale in DISPLAY space
 *   ctx.drawImage(img, -anchor.x * w, -anchor.y * h, w, h)   // w x h = sx-independent fit size, `scale` = fit * user scale
 *
 * so a rotated layer stays a rigid, un-sheared rectangle where it is looked at, then is squeezed by 1/PAR into
 * stored pixels. `scale` is the layer size as a fraction of the display frame (L x H); `position` is in stored
 * canvas pixels (y down) and `rotation` in degrees (clockwise), like every other renderer. With a square PAR it is
 * the aspect-correct rotation about the anchor.
 */
export function createTransformMatrix(
  position: { x: number; y: number },
  scale: { x: number; y: number },
  rotation: number,
  anchor: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number,
  pixelAspect = 1,
): Float32Array {
  const matrix = new Float32Array(16);
  const par = normalizeSequencePar(pixelAspect);
  // Same rounding the preview and export use for the display width, so the fit scale and this agree to the pixel.
  const layoutWidth = displayLayoutWidth(canvasWidth, par);
  const squeeze = canvasWidth / layoutWidth; // display x -> stored x
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  // Layer-local offset of the quad centre from the anchor, in display pixels before rotation.
  const halfW = (scale.x * layoutWidth) / 2;
  const halfH = (scale.y * canvasHeight) / 2;
  const offX = (1 - 2 * anchor.x) * halfW;
  const offY = (1 - 2 * anchor.y) * halfH;

  // clip.x = 2 * stored.x / W - 1, clip.y = 1 - 2 * stored.y / H (stored y grows downward).
  const toClipX = (2 * squeeze) / canvasWidth;
  const toClipY = 2 / canvasHeight;

  // Column 0: where quad x goes. Column 1: where quad y goes (quad y is up, layer y is down).
  matrix[0] = toClipX * halfW * cos;
  matrix[1] = -toClipY * halfW * sin;
  matrix[4] = toClipX * halfH * sin;
  matrix[5] = toClipY * halfH * cos;
  matrix[10] = 1;
  matrix[12] = (2 * position.x) / canvasWidth + toClipX * (cos * offX - sin * offY);
  matrix[13] = (-2 * position.y) / canvasHeight - toClipY * (sin * offX + cos * offY);
  matrix[15] = 1;

  return matrix;
}

export const effectsComputeShaderSource = /* wgsl */ `
// Effect parameters uniform buffer
struct EffectUniforms {
 brightness: f32, // -1 to 1
 contrast: f32,
 saturation: f32,
 hue: f32, // 0 to 360 degrees
 temperature: f32, // -1 to 1 (cool to warm)
 tint: f32, // -1 to 1 (green to magenta)
 shadows: f32, // -1 to 1
 highlights: f32, // -1 to 1
};

// Image dimensions
struct Dimensions {
 width: u32,
 height: u32,
 padding: vec2<u32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> effects: EffectUniforms;
@group(0) @binding(3) var<uniform> dimensions: Dimensions;
fn rgb2hsv(rgb: vec3<f32>) -> vec3<f32> {
 let r = rgb.r;
 let g = rgb.g;
 let b = rgb.b;
 
 let maxC = max(max(r, g), b);
 let minC = min(min(r, g), b);
 let delta = maxC - minC;
 
 var h: f32 = 0.0;
 var s: f32 = 0.0;
 let v: f32 = maxC;
 
 if (delta > 0.00001) {
 s = delta / maxC;
 
 if (maxC == r) {
 h = (g - b) / delta;
 if (g < b) {
 h = h + 6.0;
 }
 } else if (maxC == g) {
 h = 2.0 + (b - r) / delta;
 } else {
 h = 4.0 + (r - g) / delta;
 }
 h = h / 6.0;
 }
 
 return vec3<f32>(h, s, v);
}
fn hsv2rgb(hsv: vec3<f32>) -> vec3<f32> {
 let h = hsv.x * 6.0;
 let s = hsv.y;
 let v = hsv.z;
 
 let i = floor(h);
 let f = h - i;
 let p = v * (1.0 - s);
 let q = v * (1.0 - s * f);
 let t = v * (1.0 - s * (1.0 - f));
 
 let idx = i32(i) % 6;
 
 if (idx == 0) {
 return vec3<f32>(v, t, p);
 } else if (idx == 1) {
 return vec3<f32>(q, v, p);
 } else if (idx == 2) {
 return vec3<f32>(p, v, t);
 } else if (idx == 3) {
 return vec3<f32>(p, q, v);
 } else if (idx == 4) {
 return vec3<f32>(t, p, v);
 } else {
 return vec3<f32>(v, p, q);
 }
}
fn applyBrightness(color: vec3<f32>, brightness: f32) -> vec3<f32> {
 return clamp(color + vec3<f32>(brightness), vec3<f32>(0.0), vec3<f32>(1.0));
}
fn applyContrast(color: vec3<f32>, contrast: f32) -> vec3<f32> {
 return clamp((color - 0.5) * contrast + 0.5, vec3<f32>(0.0), vec3<f32>(1.0));
}
fn applySaturation(color: vec3<f32>, saturation: f32) -> vec3<f32> {
 let luminance = dot(color, vec3<f32>(0.299, 0.587, 0.114));
 return clamp(mix(vec3<f32>(luminance), color, saturation), vec3<f32>(0.0), vec3<f32>(1.0));
}
fn applyHueRotation(color: vec3<f32>, hueShift: f32) -> vec3<f32> {
 var hsv = rgb2hsv(color);
 hsv.x = fract(hsv.x + hueShift / 360.0);
 return hsv2rgb(hsv);
}
fn applyTemperature(color: vec3<f32>, temperature: f32) -> vec3<f32> {
 var result = color;
 if (temperature > 0.0) {
 result.r = min(1.0, result.r + temperature * 0.2);
 result.g = min(1.0, result.g + temperature * 0.1);
 result.b = max(0.0, result.b - temperature * 0.2);
 } else {
 result.r = max(0.0, result.r + temperature * 0.2);
 result.g = max(0.0, result.g + temperature * 0.05);
 result.b = min(1.0, result.b - temperature * 0.2);
 }
 return result;
}
fn applyTint(color: vec3<f32>, tint: f32) -> vec3<f32> {
 var result = color;
 result.r = clamp(result.r + tint * 0.1, 0.0, 1.0);
 result.g = clamp(result.g - tint * 0.2, 0.0, 1.0);
 result.b = clamp(result.b + tint * 0.1, 0.0, 1.0);
 return result;
}
fn smoothstepCustom(edge0: f32, edge1: f32, x: f32) -> f32 {
 let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
 return t * t * (3.0 - 2.0 * t);
}
fn applyShadowsHighlights(color: vec3<f32>, shadows: f32, highlights: f32) -> vec3<f32> {
 let luminance = dot(color, vec3<f32>(0.299, 0.587, 0.114));
 let shadowWeight = 1.0 - smoothstepCustom(0.0, 0.33, luminance);
 let highlightWeight = smoothstepCustom(0.66, 1.0, luminance);
 let adjustment = shadows * shadowWeight * 0.3 + highlights * highlightWeight * 0.3;
 return clamp(color + vec3<f32>(adjustment), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Main compute shader entry point
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
 let x = global_id.x;
 let y = global_id.y;
 
 if (x >= dimensions.width || y >= dimensions.height) {
 return;
 }
 
 let coords = vec2<i32>(i32(x), i32(y));
 var color = textureLoad(inputTexture, coords, 0);
 var rgb = color.rgb;
 if (abs(effects.brightness) > 0.001) {
 rgb = applyBrightness(rgb, effects.brightness);
 }
 if (abs(effects.contrast - 1.0) > 0.001) {
 rgb = applyContrast(rgb, effects.contrast);
 }
 if (abs(effects.saturation - 1.0) > 0.001) {
 rgb = applySaturation(rgb, effects.saturation);
 }
 if (abs(effects.hue) > 0.001) {
 rgb = applyHueRotation(rgb, effects.hue);
 }
 if (abs(effects.temperature) > 0.001) {
 rgb = applyTemperature(rgb, effects.temperature);
 }
 if (abs(effects.tint) > 0.001) {
 rgb = applyTint(rgb, effects.tint);
 }
 if (abs(effects.shadows) > 0.001 || abs(effects.highlights) > 0.001) {
 rgb = applyShadowsHighlights(rgb, effects.shadows, effects.highlights);
 }
 
 textureStore(outputTexture, coords, vec4<f32>(rgb, color.a));
}
`;

export const blurComputeShaderSource = /* wgsl */ `
// Blur parameters
struct BlurUniforms {
 radius: f32,
 sigma: f32,
 direction: vec2<f32>,
};

struct Dimensions {
 width: u32,
 height: u32,
 padding: vec2<u32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> blur: BlurUniforms;
@group(0) @binding(3) var<uniform> dimensions: Dimensions;

fn gaussianWeight(offset: f32, sigma: f32) -> f32 {
 let sigma2 = sigma * sigma;
 return exp(-(offset * offset) / (2.0 * sigma2)) / (sqrt(2.0 * 3.14159265) * sigma);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
 let x = global_id.x;
 let y = global_id.y;
 
 if (x >= dimensions.width || y >= dimensions.height) {
 return;
 }
 
 let coords = vec2<i32>(i32(x), i32(y));
 
 if (blur.radius < 0.5) {
 let color = textureLoad(inputTexture, coords, 0);
 textureStore(outputTexture, coords, color);
 return;
 }
 
 let kernelRadius = i32(min(blur.radius, 20.0));
 let sigma = max(blur.sigma, blur.radius / 3.0);
 
 var colorSum = vec4<f32>(0.0);
 var weightSum: f32 = 0.0;
 
 for (var i = -kernelRadius; i <= kernelRadius; i = i + 1) {
 let offset = vec2<i32>(i32(blur.direction.x * f32(i)), i32(blur.direction.y * f32(i)));
 let sampleCoords = coords + offset;
 let clampedCoords = vec2<i32>(
 clamp(sampleCoords.x, 0, i32(dimensions.width) - 1),
 clamp(sampleCoords.y, 0, i32(dimensions.height) - 1)
 );
 let weight = gaussianWeight(f32(i), sigma);
 colorSum = colorSum + textureLoad(inputTexture, clampedCoords, 0) * weight;
 weightSum = weightSum + weight;
 }
 
 let finalColor = colorSum / weightSum;
 textureStore(outputTexture, coords, finalColor);
}
`;

export function createEffectUniformsBuffer(
  brightness: number = 0,
  contrast: number = 1,
  saturation: number = 1,
  hue: number = 0,
  temperature: number = 0,
  tint: number = 0,
  shadows: number = 0,
  highlights: number = 0,
): Float32Array {
  const buffer = new Float32Array(8);
  buffer[0] = brightness;
  buffer[1] = contrast;
  buffer[2] = saturation;
  buffer[3] = hue;
  buffer[4] = temperature;
  buffer[5] = tint;
  buffer[6] = shadows;
  buffer[7] = highlights;
  return buffer;
}

export function createBlurUniformsBuffer(
  radius: number = 0,
  sigma: number = 0,
  directionX: number = 1,
  directionY: number = 0,
): Float32Array {
  const buffer = new Float32Array(4);
  buffer[0] = radius;
  buffer[1] = sigma > 0 ? sigma : radius / 3;
  buffer[2] = directionX;
  buffer[3] = directionY;
  return buffer;
}

export function createDimensionsBuffer(
  width: number,
  height: number,
): Uint32Array {
  const buffer = new Uint32Array(4);
  buffer[0] = width;
  buffer[1] = height;
  buffer[2] = 0; // padding
  buffer[3] = 0; // padding
  return buffer;
}
