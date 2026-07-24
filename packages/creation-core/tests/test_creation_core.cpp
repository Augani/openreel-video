// Native parity test for the creation-core C ABI.
// Verifies orc_bake_box matches the @openreel/core/creation CPU reference
// (a 2x2x2 box: 24 vertices, 12 triangles, bounds [-1,1]^3).

#include "creation_core.h"

#include <cstdio>
#include <cstring>

static int failures = 0;

static void check(bool condition, const char* message) {
  if (!condition) {
    std::printf("FAIL: %s\n", message);
    failures += 1;
  }
}

int main() {
  check(std::strcmp(orc_version(), "0.1.0") == 0, "version is 0.1.0");

  orc_mesh_stats stats = orc_bake_box(2.0f, 2.0f, 2.0f);
  check(stats.vertex_count == 24, "box has 24 vertices");
  check(stats.triangle_count == 12, "box has 12 triangles");
  check(stats.bounds.min[0] == -1.0f, "min x is -1");
  check(stats.bounds.min[1] == -1.0f, "min y is -1");
  check(stats.bounds.min[2] == -1.0f, "min z is -1");
  check(stats.bounds.max[0] == 1.0f, "max x is 1");
  check(stats.bounds.max[1] == 1.0f, "max y is 1");
  check(stats.bounds.max[2] == 1.0f, "max z is 1");

  const float positions[] = {
      -0.8f, -0.8f, 0.0f,
      0.8f, -0.8f, 0.0f,
      0.0f, 0.8f, 0.0f,
  };
  const float normals[] = {
      0.0f, 0.0f, 1.0f,
      0.0f, 0.0f, 1.0f,
      0.0f, 0.0f, 1.0f,
  };
  const float colors[] = {
      0.0f, 1.0f, 0.0f,
      0.0f, 1.0f, 0.0f,
      0.0f, 1.0f, 0.0f,
  };
  const uint32_t indices[] = {0, 1, 2};
  uint8_t rgba[32 * 32 * 4] = {0};
  orc_render_options render_options{};
  render_options.width = 32;
  render_options.height = 32;
  render_options.camera.position[0] = 0.0f;
  render_options.camera.position[1] = 0.0f;
  render_options.camera.position[2] = 2.0f;
  render_options.camera.target[0] = 0.0f;
  render_options.camera.target[1] = 0.0f;
  render_options.camera.target[2] = 0.0f;
  render_options.camera.up[0] = 0.0f;
  render_options.camera.up[1] = 1.0f;
  render_options.camera.up[2] = 0.0f;
  render_options.camera.fov_degrees = 45.0f;
  render_options.light.direction[0] = 0.0f;
  render_options.light.direction[1] = 0.0f;
  render_options.light.direction[2] = 1.0f;
  render_options.light.ambient = 0.15f;
  render_options.light.intensity = 0.85f;
  render_options.base_color[0] = 0.0f;
  render_options.base_color[1] = 1.0f;
  render_options.base_color[2] = 0.0f;
  render_options.background[0] = 0.06f;
  render_options.background[1] = 0.09f;
  render_options.background[2] = 0.16f;
  render_options.shadows = 1;

  orc_render_stats render_stats =
      orc_render_mesh_rgba(positions,
                           9,
                           normals,
                           9,
                           colors,
                           9,
                           indices,
                           3,
                           &render_options,
                           rgba,
                           sizeof(rgba));
  check(render_stats.width == 32, "render width matches");
  check(render_stats.height == 32, "render height matches");
  check(render_stats.covered_pixels > 0, "triangle covers pixels");
  check(render_stats.shadowed_pixels == 0, "single triangle casts no self-shadow");
  const int center = (16 * 32 + 16) * 4;
  check(rgba[center + 1] > rgba[center], "center pixel is green-dominant");
  check(rgba[center + 1] > rgba[center + 2], "center pixel keeps vertex color");

  if (failures == 0) {
    std::printf("creation_core native parity test passed\n");
    return 0;
  }
  std::printf("creation_core native parity test failed (%d)\n", failures);
  return 1;
}
