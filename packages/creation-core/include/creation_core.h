/*
 * OpenReel Creation Core - C ABI boundary.
 *
 * This header defines the stable C ABI that the native (C++20) creation engine
 * exposes to the TypeScript/Electron host via @openreel/creation-bindings.
 *
 * The deterministic CPU reference implementation of every function here lives in
 * the TypeScript package @openreel/core/creation (geometry/sdf/rig/sim/render).
 * The native build must produce bit-compatible results for the golden tests.
 */
#ifndef OPENREEL_CREATION_CORE_H
#define OPENREEL_CREATION_CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct orc_bounds3 {
  float min[3];
  float max[3];
} orc_bounds3;

typedef struct orc_mesh_stats {
  int32_t vertex_count;
  int32_t triangle_count;
  orc_bounds3 bounds;
} orc_mesh_stats;

typedef struct orc_render_camera {
  float position[3];
  float target[3];
  float up[3];
  float fov_degrees;
} orc_render_camera;

typedef struct orc_render_light {
  float direction[3];
  float ambient;
  float intensity;
} orc_render_light;

typedef struct orc_render_options {
  int32_t width;
  int32_t height;
  orc_render_camera camera;
  orc_render_light light;
  float base_color[3];
  float background[3];
  int32_t shadows;
} orc_render_options;

typedef struct orc_render_stats {
  int32_t width;
  int32_t height;
  int32_t covered_pixels;
  int32_t shadowed_pixels;
} orc_render_stats;

/* Returns the engine version string (parity with CREATION_STATE_VERSION). */
const char* orc_version(void);

/*
 * Bake a centered box primitive and return its mesh statistics.
 * Reference: buildBox() + computeMeshStats() in @openreel/core/creation/geometry.
 */
orc_mesh_stats orc_bake_box(float width, float height, float depth);

/*
 * Ray-trace a mesh into an RGBA framebuffer.
 * positions/normals/colors are flat float arrays; indices is a flat u32 triangle list.
 * colors is optional (pass NULL / 0 length to use options->base_color).
 * out_rgba must point to width*height*4 writable bytes.
 */
orc_render_stats orc_render_mesh_rgba(const float* positions,
                                      int32_t position_count,
                                      const float* normals,
                                      int32_t normal_count,
                                      const float* colors,
                                      int32_t color_count,
                                      const uint32_t* indices,
                                      int32_t index_count,
                                      const orc_render_options* options,
                                      uint8_t* out_rgba,
                                      int32_t out_rgba_length);

#ifdef __cplusplus
}
#endif

#endif /* OPENREEL_CREATION_CORE_H */
