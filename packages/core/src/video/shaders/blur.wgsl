/**
 * Blur Compute Shader - GPU-accelerated Gaussian blur
 *
 * Implements a separable Gaussian blur using compute shaders for
 * high-performance parallel processing.
 *
 */

// Blur parameters
struct BlurUniforms {
    radius: f32,        // Blur radius
    sigma: f32,         // Gaussian sigma (typically radius / 3)
    direction: vec2<f32>,// Blur direction (x, y) for separable passes
    maskY: f32,         // Mask Y coordinate (e.g. 0.8 means blur only below 80%)
};

// Image dimensions
struct Dimensions {
    width: u32,
    height: u32,
    padding: vec2<u32>,
};

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> blur: BlurUniforms;
@group(0) @binding(3) var<uniform> dimensions: Dimensions;

// Pre-computed Gaussian weights for common kernel sizes
// Using shared memory for workgroup optimization
var<workgroup> sharedPixels: array<vec4<f32>, 288>; // 16 + 256 + 16 for padding

// Calculate Gaussian weight
fn gaussianWeight(offset: f32, sigma: f32) -> f32 {
    let sigma2 = sigma * sigma;
    return exp(-(offset * offset) / (2.0 * sigma2)) / (sqrt(2.0 * 3.14159265) * sigma);
}

// Main compute shader for separable Gaussian blur
// Uses workgroup parallelization for performance
@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>,
        @builtin(local_invocation_id) local_id: vec3<u32>,
        @builtin(workgroup_id) workgroup_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    // Bounds check
    if (x >= dimensions.width || y >= dimensions.height) {
        return;
    }
    
    let coords = vec2<i32>(i32(x), i32(y));
    let normalizedY = f32(y) / f32(dimensions.height);
    
    // Skip if no blur needed, or if masked
    if (blur.radius < 0.5 || (blur.maskY > 0.0 && normalizedY < blur.maskY)) {
        let color = textureLoad(inputTexture, coords, 0);
        textureStore(outputTexture, coords, color);
        return;
    }
    
    // Clamp radius to prevent excessive texture sampling
    let kernelRadius = i32(min(blur.radius, 20.0));
    let sigma = max(blur.sigma, blur.radius / 3.0);
    
    // Accumulate weighted samples
    var colorSum = vec4<f32>(0.0);
    var weightSum: f32 = 0.0;
    
    // Sample along blur direction
    for (var i = -kernelRadius; i <= kernelRadius; i = i + 1) {
        let offset = vec2<i32>(i32(blur.direction.x * f32(i)), i32(blur.direction.y * f32(i)));
        let sampleCoords = coords + offset;
        
        // Clamp to texture bounds
        let clampedCoords = vec2<i32>(
            clamp(sampleCoords.x, 0, i32(dimensions.width) - 1),
            clamp(sampleCoords.y, 0, i32(dimensions.height) - 1)
        );
        
        // Calculate Gaussian weight
        let weight = gaussianWeight(f32(i), sigma);
        
        // Accumulate
        colorSum = colorSum + textureLoad(inputTexture, clampedCoords, 0) * weight;
        weightSum = weightSum + weight;
    }
    
    // Normalize and write output
    let finalColor = colorSum / weightSum;
    textureStore(outputTexture, coords, finalColor);
}

/**
 * Optimized horizontal blur pass using shared memory
 * This variant loads pixels into shared memory for faster access
 */
@compute @workgroup_size(256, 1, 1)
fn horizontalBlur(@builtin(global_invocation_id) global_id: vec3<u32>,
                  @builtin(local_invocation_id) local_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    let localX = local_id.x;
    
    // Bounds check
    if (y >= dimensions.height) {
        return;
    }
    
    let kernelRadius = i32(min(blur.radius, 16.0));
    let sigma = max(blur.sigma, blur.radius / 3.0);
    
    // Load pixel into shared memory with padding for kernel
    let loadX = i32(x) - kernelRadius + i32(localX);
    let clampedX = clamp(loadX, 0, i32(dimensions.width) - 1);
    let loadCoords = vec2<i32>(clampedX, i32(y));
    
    // Load center pixel
    sharedPixels[localX + u32(kernelRadius)] = textureLoad(inputTexture, loadCoords, 0);
    
    // Load left padding
    if (localX < u32(kernelRadius)) {
        let leftX = clamp(i32(x) - kernelRadius + i32(localX) - kernelRadius, 0, i32(dimensions.width) - 1);
        sharedPixels[localX] = textureLoad(inputTexture, vec2<i32>(leftX, i32(y)), 0);
    }
    
    // Load right padding
    if (localX >= 256u - u32(kernelRadius)) {
        let rightX = clamp(i32(x) + kernelRadius + i32(localX) - 256 + kernelRadius, 0, i32(dimensions.width) - 1);
        sharedPixels[localX + u32(kernelRadius) * 2u] = textureLoad(inputTexture, vec2<i32>(rightX, i32(y)), 0);
    }
    
    // Synchronize workgroup
    workgroupBarrier();
    
    // Bounds check for output
    if (x >= dimensions.width) {
        return;
    }
    
    // Apply blur using shared memory
    var colorSum = vec4<f32>(0.0);
    var weightSum: f32 = 0.0;
    
    for (var i = -kernelRadius; i <= kernelRadius; i = i + 1) {
        let weight = gaussianWeight(f32(i), sigma);
        let sharedIdx = i32(localX) + kernelRadius + i;
        colorSum = colorSum + sharedPixels[sharedIdx] * weight;
        weightSum = weightSum + weight;
    }
    
    let finalColor = colorSum / weightSum;
    textureStore(outputTexture, vec2<i32>(i32(x), i32(y)), finalColor);
}

/**
 * Optimized vertical blur pass using shared memory
 */
@compute @workgroup_size(1, 256, 1)
fn verticalBlur(@builtin(global_invocation_id) global_id: vec3<u32>,
                @builtin(local_invocation_id) local_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    let localY = local_id.y;
    
    // Bounds check
    if (x >= dimensions.width) {
        return;
    }
    
    let kernelRadius = i32(min(blur.radius, 16.0));
    let sigma = max(blur.sigma, blur.radius / 3.0);
    
    // Load pixel into shared memory with padding for kernel
    let loadY = i32(y) - kernelRadius + i32(localY);
    let clampedY = clamp(loadY, 0, i32(dimensions.height) - 1);
    let loadCoords = vec2<i32>(i32(x), clampedY);
    
    // Load center pixel
    sharedPixels[localY + u32(kernelRadius)] = textureLoad(inputTexture, loadCoords, 0);
    
    // Load top padding
    if (localY < u32(kernelRadius)) {
        let topY = clamp(i32(y) - kernelRadius + i32(localY) - kernelRadius, 0, i32(dimensions.height) - 1);
        sharedPixels[localY] = textureLoad(inputTexture, vec2<i32>(i32(x), topY), 0);
    }
    
    // Load bottom padding
    if (localY >= 256u - u32(kernelRadius)) {
        let bottomY = clamp(i32(y) + kernelRadius + i32(localY) - 256 + kernelRadius, 0, i32(dimensions.height) - 1);
        sharedPixels[localY + u32(kernelRadius) * 2u] = textureLoad(inputTexture, vec2<i32>(i32(x), bottomY), 0);
    }
    
    // Synchronize workgroup
    workgroupBarrier();
    
    // Bounds check for output
    if (y >= dimensions.height) {
        return;
    }
    
    // Apply blur using shared memory
    var colorSum = vec4<f32>(0.0);
    var weightSum: f32 = 0.0;
    
    for (var i = -kernelRadius; i <= kernelRadius; i = i + 1) {
        let weight = gaussianWeight(f32(i), sigma);
        let sharedIdx = i32(localY) + kernelRadius + i;
        colorSum = colorSum + sharedPixels[sharedIdx] * weight;
        weightSum = weightSum + weight;
    }
    
    let finalColor = colorSum / weightSum;
    textureStore(outputTexture, vec2<i32>(i32(x), i32(y)), finalColor);
}

/**
 * Box blur for fast approximate blur
 * Useful for real-time preview with lower quality requirements
 */
@compute @workgroup_size(16, 16, 1)
fn boxBlur(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let x = global_id.x;
    let y = global_id.y;
    
    // Bounds check
    if (x >= dimensions.width || y >= dimensions.height) {
        return;
    }
    
    let coords = vec2<i32>(i32(x), i32(y));
    
    // Early exit for zero radius
    if (blur.radius < 0.5) {
        let color = textureLoad(inputTexture, coords, 0);
        textureStore(outputTexture, coords, color);
        return;
    }
    
    let kernelRadius = i32(min(blur.radius, 10.0));
    
    // Accumulate samples in box
    var colorSum = vec4<f32>(0.0);
    var sampleCount: f32 = 0.0;
    
    for (var dy = -kernelRadius; dy <= kernelRadius; dy = dy + 1) {
        for (var dx = -kernelRadius; dx <= kernelRadius; dx = dx + 1) {
            let sampleCoords = vec2<i32>(
                clamp(coords.x + dx, 0, i32(dimensions.width) - 1),
                clamp(coords.y + dy, 0, i32(dimensions.height) - 1)
            );
            colorSum = colorSum + textureLoad(inputTexture, sampleCoords, 0);
            sampleCount = sampleCount + 1.0;
        }
    }
    
    let finalColor = colorSum / sampleCount;
    textureStore(outputTexture, coords, finalColor);
}
