// OpenReel Creation Core - native C++ implementation of the C ABI.
//
// This is the Phase 0 native scaffold. It implements the C ABI declared in
// include/creation_core.h with results that match the TypeScript CPU reference
// in @openreel/core/creation. Build with CMake (see CMakeLists.txt); the
// @openreel/creation-bindings package loads the resulting library and falls
// back to the CPU reference when it is unavailable.

#include "creation_core.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace {
constexpr const char* kVersion = "0.1.0";
constexpr float kPi = 3.14159265358979323846f;

struct Vec3 {
  float x;
  float y;
  float z;
};

struct Rgb8 {
  uint8_t r;
  uint8_t g;
  uint8_t b;
};

struct Triangle {
  Vec3 a;
  Vec3 b;
  Vec3 c;
  Vec3 na;
  Vec3 nb;
  Vec3 nc;
  Rgb8 ca;
  Rgb8 cb;
  Rgb8 cc;
};

struct Hit {
  float t;
  float u;
  float v;
  Triangle triangle;
};

constexpr float kEpsilon = 1e-7f;

float clamp01(float value) {
  return std::max(0.0f, std::min(1.0f, value));
}

uint8_t clampByte(float value) {
  const float clamped = std::max(0.0f, std::min(255.0f, std::round(value)));
  return static_cast<uint8_t>(clamped);
}

Vec3 add(Vec3 a, Vec3 b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 sub(Vec3 a, Vec3 b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 scale(Vec3 a, float s) {
  return {a.x * s, a.y * s, a.z * s};
}

Vec3 cross(Vec3 a, Vec3 b) {
  return {
      a.y * b.z - a.z * b.y,
      a.z * b.x - a.x * b.z,
      a.x * b.y - a.y * b.x,
  };
}

float dot(Vec3 a, Vec3 b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 normalize(Vec3 value) {
  const float len = std::sqrt(dot(value, value));
  if (len <= kEpsilon) {
    return {0.0f, 0.0f, 1.0f};
  }
  return {value.x / len, value.y / len, value.z / len};
}

Vec3 readVec3(const float* values, int32_t value_count, uint32_t vertex_index, Vec3 fallback) {
  const int64_t offset = static_cast<int64_t>(vertex_index) * 3;
  if (!values || offset + 2 >= value_count) {
    return fallback;
  }
  return {values[offset], values[offset + 1], values[offset + 2]};
}

Rgb8 readColor(const float* colors, int32_t color_count, uint32_t vertex_index, Rgb8 fallback) {
  const int64_t offset = static_cast<int64_t>(vertex_index) * 3;
  if (!colors || offset + 2 >= color_count) {
    return fallback;
  }
  return {
      clampByte(colors[offset] * 255.0f),
      clampByte(colors[offset + 1] * 255.0f),
      clampByte(colors[offset + 2] * 255.0f),
  };
}

Triangle buildTriangle(const float* positions,
                       int32_t position_count,
                       const float* normals,
                       int32_t normal_count,
                       const float* colors,
                       int32_t color_count,
                       uint32_t ia,
                       uint32_t ib,
                       uint32_t ic,
                       Rgb8 fallback_color) {
  return {
      readVec3(positions, position_count, ia, {0.0f, 0.0f, 0.0f}),
      readVec3(positions, position_count, ib, {0.0f, 0.0f, 0.0f}),
      readVec3(positions, position_count, ic, {0.0f, 0.0f, 0.0f}),
      readVec3(normals, normal_count, ia, {0.0f, 0.0f, 1.0f}),
      readVec3(normals, normal_count, ib, {0.0f, 0.0f, 1.0f}),
      readVec3(normals, normal_count, ic, {0.0f, 0.0f, 1.0f}),
      readColor(colors, color_count, ia, fallback_color),
      readColor(colors, color_count, ib, fallback_color),
      readColor(colors, color_count, ic, fallback_color),
  };
}

bool intersectTriangle(Vec3 origin, Vec3 dir, const Triangle& triangle, Hit* out_hit) {
  const Vec3 edge1 = sub(triangle.b, triangle.a);
  const Vec3 edge2 = sub(triangle.c, triangle.a);
  const Vec3 pvec = cross(dir, edge2);
  const float det = dot(edge1, pvec);
  if (std::fabs(det) < kEpsilon) {
    return false;
  }
  const float inv_det = 1.0f / det;
  const Vec3 tvec = sub(origin, triangle.a);
  const float u = dot(tvec, pvec) * inv_det;
  if (u < 0.0f || u > 1.0f) {
    return false;
  }
  const Vec3 qvec = cross(tvec, edge1);
  const float v = dot(dir, qvec) * inv_det;
  if (v < 0.0f || u + v > 1.0f) {
    return false;
  }
  const float t = dot(edge2, qvec) * inv_det;
  if (t < kEpsilon) {
    return false;
  }
  if (out_hit) {
    *out_hit = {t, u, v, triangle};
  }
  return true;
}

bool closestHit(const float* positions,
                int32_t position_count,
                const float* normals,
                int32_t normal_count,
                const float* colors,
                int32_t color_count,
                const uint32_t* indices,
                int32_t index_count,
                Vec3 origin,
                Vec3 dir,
                Rgb8 fallback_color,
                Hit* out_hit) {
  bool found = false;
  Hit best{};
  for (int32_t index = 0; index + 2 < index_count; index += 3) {
    const Triangle triangle = buildTriangle(positions,
                                            position_count,
                                            normals,
                                            normal_count,
                                            colors,
                                            color_count,
                                            indices[index],
                                            indices[index + 1],
                                            indices[index + 2],
                                            fallback_color);
    Hit hit{};
    if (intersectTriangle(origin, dir, triangle, &hit) && (!found || hit.t < best.t)) {
      best = hit;
      found = true;
    }
  }
  if (found && out_hit) {
    *out_hit = best;
  }
  return found;
}

bool anyHit(const float* positions,
            int32_t position_count,
            const float* normals,
            int32_t normal_count,
            const float* colors,
            int32_t color_count,
            const uint32_t* indices,
            int32_t index_count,
            Vec3 origin,
            Vec3 dir,
            float max_t,
            Rgb8 fallback_color) {
  for (int32_t index = 0; index + 2 < index_count; index += 3) {
    const Triangle triangle = buildTriangle(positions,
                                            position_count,
                                            normals,
                                            normal_count,
                                            colors,
                                            color_count,
                                            indices[index],
                                            indices[index + 1],
                                            indices[index + 2],
                                            fallback_color);
    Hit hit{};
    if (intersectTriangle(origin, dir, triangle, &hit) && hit.t < max_t) {
      return true;
    }
  }
  return false;
}

Vec3 barycentricNormal(const Hit& hit) {
  const float w = 1.0f - hit.u - hit.v;
  return normalize({
      w * hit.triangle.na.x + hit.u * hit.triangle.nb.x + hit.v * hit.triangle.nc.x,
      w * hit.triangle.na.y + hit.u * hit.triangle.nb.y + hit.v * hit.triangle.nc.y,
      w * hit.triangle.na.z + hit.u * hit.triangle.nb.z + hit.v * hit.triangle.nc.z,
  });
}

Rgb8 barycentricColor(const Hit& hit) {
  const float w = 1.0f - hit.u - hit.v;
  return {
      clampByte(w * hit.triangle.ca.r + hit.u * hit.triangle.cb.r + hit.v * hit.triangle.cc.r),
      clampByte(w * hit.triangle.ca.g + hit.u * hit.triangle.cb.g + hit.v * hit.triangle.cc.g),
      clampByte(w * hit.triangle.ca.b + hit.u * hit.triangle.cb.b + hit.v * hit.triangle.cc.b),
  };
}

Rgb8 rgb8FromFloats(const float color[3], Rgb8 fallback) {
  if (!color) {
    return fallback;
  }
  return {
      clampByte(clamp01(color[0]) * 255.0f),
      clampByte(clamp01(color[1]) * 255.0f),
      clampByte(clamp01(color[2]) * 255.0f),
  };
}

void writePixel(uint8_t* rgba, int32_t width, int32_t x, int32_t y, Rgb8 color) {
  const int64_t offset = static_cast<int64_t>(y) * width * 4 + static_cast<int64_t>(x) * 4;
  rgba[offset] = color.r;
  rgba[offset + 1] = color.g;
  rgba[offset + 2] = color.b;
  rgba[offset + 3] = 255;
}
}

extern "C" const char* orc_version(void) { return kVersion; }

extern "C" orc_mesh_stats orc_bake_box(float width, float height, float depth) {
  const float hx = std::max(1e-4f, width) * 0.5f;
  const float hy = std::max(1e-4f, height) * 0.5f;
  const float hz = std::max(1e-4f, depth) * 0.5f;

  orc_mesh_stats stats{};
  // A box has 6 faces x 4 vertices and 6 faces x 2 triangles.
  stats.vertex_count = 24;
  stats.triangle_count = 12;
  stats.bounds.min[0] = -hx;
  stats.bounds.min[1] = -hy;
  stats.bounds.min[2] = -hz;
  stats.bounds.max[0] = hx;
  stats.bounds.max[1] = hy;
  stats.bounds.max[2] = hz;
  return stats;
}

extern "C" orc_render_stats orc_render_mesh_rgba(const float* positions,
                                                 int32_t position_count,
                                                 const float* normals,
                                                 int32_t normal_count,
                                                 const float* colors,
                                                 int32_t color_count,
                                                 const uint32_t* indices,
                                                 int32_t index_count,
                                                 const orc_render_options* options,
                                                 uint8_t* out_rgba,
                                                 int32_t out_rgba_length) {
  orc_render_stats stats{};
  if (!options) {
    return stats;
  }

  const int32_t width = std::max(1, options->width);
  const int32_t height = std::max(1, options->height);
  stats.width = width;
  stats.height = height;

  const int64_t required_bytes = static_cast<int64_t>(width) * height * 4;
  if (!positions || position_count < 9 || !indices || index_count < 3 || !out_rgba ||
      out_rgba_length < required_bytes) {
    return stats;
  }

  const Rgb8 fallback_color = rgb8FromFloats(options->base_color, {148, 163, 184});
  const Rgb8 background = rgb8FromFloats(options->background, {15, 23, 42});
  for (int32_t py = 0; py < height; py += 1) {
    for (int32_t px = 0; px < width; px += 1) {
      writePixel(out_rgba, width, px, py, background);
    }
  }

  const Vec3 eye = {options->camera.position[0], options->camera.position[1], options->camera.position[2]};
  const Vec3 target = {options->camera.target[0], options->camera.target[1], options->camera.target[2]};
  const Vec3 up = normalize({options->camera.up[0], options->camera.up[1], options->camera.up[2]});
  const Vec3 forward = normalize(sub(target, eye));
  const Vec3 right = normalize(cross(forward, up));
  const Vec3 true_up = cross(right, forward);
  const float fov = options->camera.fov_degrees > 0.0f ? options->camera.fov_degrees : 45.0f;
  const float half_height = std::tan((fov * kPi / 180.0f) * 0.5f);
  const float half_width = half_height * (static_cast<float>(width) / height);

  const Vec3 light_dir = normalize({
      options->light.direction[0],
      options->light.direction[1],
      options->light.direction[2],
  });
  const float ambient = options->light.ambient > 0.0f ? options->light.ambient : 0.2f;
  const float intensity = options->light.intensity > 0.0f ? options->light.intensity : 0.9f;
  const bool shadows = options->shadows != 0;

  for (int32_t py = 0; py < height; py += 1) {
    for (int32_t px = 0; px < width; px += 1) {
      const float ndc_x = ((((static_cast<float>(px) + 0.5f) / width) * 2.0f) - 1.0f) * half_width;
      const float ndc_y = (1.0f - (((static_cast<float>(py) + 0.5f) / height) * 2.0f)) * half_height;
      const Vec3 dir = normalize(add(add(forward, scale(right, ndc_x)), scale(true_up, ndc_y)));

      Hit hit{};
      if (!closestHit(positions,
                      position_count,
                      normals,
                      normal_count,
                      colors,
                      color_count,
                      indices,
                      index_count,
                      eye,
                      dir,
                      fallback_color,
                      &hit)) {
        continue;
      }

      stats.covered_pixels += 1;
      const Vec3 normal = barycentricNormal(hit);
      const Vec3 point = add(eye, scale(dir, hit.t));
      float diffuse = std::max(0.0f, dot(normal, light_dir));
      if (shadows && diffuse > 0.0f) {
        const Vec3 shadow_origin = add(point, scale(normal, 1e-4f));
        if (anyHit(positions,
                   position_count,
                   normals,
                   normal_count,
                   colors,
                   color_count,
                   indices,
                   index_count,
                   shadow_origin,
                   light_dir,
                   1e6f,
                   fallback_color)) {
          diffuse = 0.0f;
          stats.shadowed_pixels += 1;
        }
      }

      const float shade = clamp01(ambient + intensity * diffuse);
      const Rgb8 color = barycentricColor(hit);
      writePixel(out_rgba,
                 width,
                 px,
                 py,
                 {
                     clampByte(color.r * shade),
                     clampByte(color.g * shade),
                     clampByte(color.b * shade),
                 });
    }
  }

  return stats;
}
