// Node N-API addon exposing the @openreel/creation-core C ABI to the Electron
// host. Built with node-gyp; loaded by ../src/index.ts via loadNativeAddon().

#include <stdbool.h>
#include <stdlib.h>

#include <node_api.h>
#include "creation_core.h"

static napi_value Version(napi_env env, napi_callback_info info) {
  napi_value out;
  napi_create_string_utf8(env, orc_version(), NAPI_AUTO_LENGTH, &out);
  return out;
}

static napi_value BakeBox(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value args[3];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  double width = 1.0, height = 1.0, depth = 1.0;
  if (argc > 0) napi_get_value_double(env, args[0], &width);
  if (argc > 1) napi_get_value_double(env, args[1], &height);
  if (argc > 2) napi_get_value_double(env, args[2], &depth);

  orc_mesh_stats stats = orc_bake_box((float)width, (float)height, (float)depth);

  napi_value result;
  napi_create_object(env, &result);

  napi_value vertexCount, triangleCount;
  napi_create_int32(env, stats.vertex_count, &vertexCount);
  napi_create_int32(env, stats.triangle_count, &triangleCount);
  napi_set_named_property(env, result, "vertex_count", vertexCount);
  napi_set_named_property(env, result, "triangle_count", triangleCount);

  napi_value bounds, minArray, maxArray;
  napi_create_object(env, &bounds);
  napi_create_array_with_length(env, 3, &minArray);
  napi_create_array_with_length(env, 3, &maxArray);
  for (int i = 0; i < 3; i++) {
    napi_value minValue, maxValue;
    napi_create_double(env, stats.bounds.min[i], &minValue);
    napi_create_double(env, stats.bounds.max[i], &maxValue);
    napi_set_element(env, minArray, i, minValue);
    napi_set_element(env, maxArray, i, maxValue);
  }
  napi_set_named_property(env, bounds, "min", minArray);
  napi_set_named_property(env, bounds, "max", maxArray);
  napi_set_named_property(env, result, "bounds", bounds);

  return result;
}

static bool ReadTypedArray(napi_env env,
                           napi_value value,
                           napi_typedarray_type expected_type,
                           void** data,
                           size_t* length) {
  bool is_typed_array = false;
  napi_is_typedarray(env, value, &is_typed_array);
  if (!is_typed_array) return false;

  napi_typedarray_type type;
  size_t byte_offset = 0;
  napi_value array_buffer;
  size_t element_length = 0;
  if (napi_get_typedarray_info(
          env,
          value,
          &type,
          &element_length,
          data,
          &array_buffer,
          &byte_offset) != napi_ok) {
    return false;
  }

  if (type != expected_type) return false;
  *length = element_length;
  return true;
}

static bool ReadNamedValue(napi_env env, napi_value object, const char* name, napi_value* value) {
  bool has_property = false;
  if (napi_has_named_property(env, object, name, &has_property) != napi_ok || !has_property) {
    return false;
  }
  return napi_get_named_property(env, object, name, value) == napi_ok;
}

static double ReadDoubleValue(napi_env env, napi_value value, double fallback) {
  double out = fallback;
  if (napi_get_value_double(env, value, &out) != napi_ok) {
    return fallback;
  }
  return out;
}

static bool ReadDoubleProp(napi_env env,
                           napi_value object,
                           const char* name,
                           double fallback,
                           double* out) {
  napi_value value;
  if (!ReadNamedValue(env, object, name, &value)) {
    *out = fallback;
    return false;
  }
  *out = ReadDoubleValue(env, value, fallback);
  return true;
}

static bool ReadBoolProp(napi_env env,
                         napi_value object,
                         const char* name,
                         bool fallback,
                         bool* out) {
  napi_value value;
  if (!ReadNamedValue(env, object, name, &value)) {
    *out = fallback;
    return false;
  }
  bool parsed = fallback;
  if (napi_get_value_bool(env, value, &parsed) != napi_ok) {
    *out = fallback;
    return false;
  }
  *out = parsed;
  return true;
}

static void CopyArray3(napi_env env,
                       napi_value object,
                       const char* name,
                       const float fallback[3],
                       float out[3]) {
  napi_value array;
  if (!ReadNamedValue(env, object, name, &array)) {
    out[0] = fallback[0];
    out[1] = fallback[1];
    out[2] = fallback[2];
    return;
  }

  uint32_t length = 0;
  if (napi_get_array_length(env, array, &length) != napi_ok || length < 3) {
    out[0] = fallback[0];
    out[1] = fallback[1];
    out[2] = fallback[2];
    return;
  }

  for (uint32_t index = 0; index < 3; index++) {
    napi_value value;
    if (napi_get_element(env, array, index, &value) != napi_ok) {
      out[index] = fallback[index];
      continue;
    }
    out[index] = (float)ReadDoubleValue(env, value, fallback[index]);
  }
}

static napi_value RenderMesh(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  if (argc < 5) {
    napi_throw_error(env, NULL, "orc_render_mesh requires positions, normals, colors, indices, and options");
    return NULL;
  }

  float* positions = NULL;
  size_t position_count = 0;
  float* normals = NULL;
  size_t normal_count = 0;
  float* colors = NULL;
  size_t color_count = 0;
  uint32_t* indices = NULL;
  size_t index_count = 0;

  if (!ReadTypedArray(env, args[0], napi_float32_array, (void**)&positions, &position_count) ||
      !ReadTypedArray(env, args[1], napi_float32_array, (void**)&normals, &normal_count) ||
      !ReadTypedArray(env, args[3], napi_uint32_array, (void**)&indices, &index_count)) {
    napi_throw_error(env, NULL, "orc_render_mesh received malformed typed arrays");
    return NULL;
  }

  napi_valuetype colors_type = napi_undefined;
  napi_typeof(env, args[2], &colors_type);
  if (colors_type != napi_null && colors_type != napi_undefined) {
    if (!ReadTypedArray(env, args[2], napi_float32_array, (void**)&colors, &color_count)) {
      napi_throw_error(env, NULL, "orc_render_mesh colors must be a Float32Array when provided");
      return NULL;
    }
  }

  orc_render_options options = {0};
  double width = 64.0;
  double height = 64.0;
  double camera_fov = 45.0;
  double light_ambient = 0.2;
  double light_intensity = 0.9;
  bool shadows = true;
  const float camera_position_fallback[3] = {2.5f, 2.0f, 3.5f};
  const float camera_target_fallback[3] = {0.0f, 0.0f, 0.0f};
  const float camera_up_fallback[3] = {0.0f, 1.0f, 0.0f};
  const float light_direction_fallback[3] = {0.4f, 0.9f, 0.5f};
  const float base_color_fallback[3] = {0.58f, 0.64f, 0.72f};
  const float background_fallback[3] = {0.06f, 0.09f, 0.16f};

  ReadDoubleProp(env, args[4], "width", 64.0, &width);
  ReadDoubleProp(env, args[4], "height", 64.0, &height);
  ReadDoubleProp(env, args[4], "cameraFov", 45.0, &camera_fov);
  ReadDoubleProp(env, args[4], "lightAmbient", 0.2, &light_ambient);
  ReadDoubleProp(env, args[4], "lightIntensity", 0.9, &light_intensity);
  ReadBoolProp(env, args[4], "shadows", true, &shadows);
  CopyArray3(env, args[4], "cameraPosition", camera_position_fallback, options.camera.position);
  CopyArray3(env, args[4], "cameraTarget", camera_target_fallback, options.camera.target);
  CopyArray3(env, args[4], "cameraUp", camera_up_fallback, options.camera.up);
  CopyArray3(env, args[4], "lightDirection", light_direction_fallback, options.light.direction);
  CopyArray3(env, args[4], "baseColor", base_color_fallback, options.base_color);
  CopyArray3(env, args[4], "background", background_fallback, options.background);

  options.width = (int32_t)width;
  options.height = (int32_t)height;
  options.camera.fov_degrees = (float)camera_fov;
  options.light.ambient = (float)light_ambient;
  options.light.intensity = (float)light_intensity;
  options.shadows = shadows ? 1 : 0;

  const size_t rgba_length = (size_t)(options.width < 1 ? 1 : options.width) *
                             (size_t)(options.height < 1 ? 1 : options.height) * 4;
  void* rgba_data = NULL;
  napi_value rgba_buffer;
  if (napi_create_buffer(env, rgba_length, &rgba_data, &rgba_buffer) != napi_ok) {
    napi_throw_error(env, NULL, "Failed to allocate RGBA buffer");
    return NULL;
  }

  orc_render_stats stats = orc_render_mesh_rgba(positions,
                                                (int32_t)position_count,
                                                normals,
                                                (int32_t)normal_count,
                                                colors,
                                                (int32_t)color_count,
                                                indices,
                                                (int32_t)index_count,
                                                &options,
                                                (uint8_t*)rgba_data,
                                                (int32_t)rgba_length);

  napi_value result;
  napi_create_object(env, &result);

  napi_value width_value, height_value, covered_pixels, shadowed_pixels;
  napi_create_int32(env, stats.width, &width_value);
  napi_create_int32(env, stats.height, &height_value);
  napi_create_int32(env, stats.covered_pixels, &covered_pixels);
  napi_create_int32(env, stats.shadowed_pixels, &shadowed_pixels);
  napi_set_named_property(env, result, "rgba", rgba_buffer);
  napi_set_named_property(env, result, "width", width_value);
  napi_set_named_property(env, result, "height", height_value);
  napi_set_named_property(env, result, "covered_pixels", covered_pixels);
  napi_set_named_property(env, result, "shadowed_pixels", shadowed_pixels);
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value versionFn, bakeBoxFn, renderMeshFn;
  napi_create_function(env, "orc_version", NAPI_AUTO_LENGTH, Version, NULL, &versionFn);
  napi_create_function(env, "orc_bake_box", NAPI_AUTO_LENGTH, BakeBox, NULL, &bakeBoxFn);
  napi_create_function(env, "orc_render_mesh", NAPI_AUTO_LENGTH, RenderMesh, NULL, &renderMeshFn);
  napi_set_named_property(env, exports, "orc_version", versionFn);
  napi_set_named_property(env, exports, "orc_bake_box", bakeBoxFn);
  napi_set_named_property(env, exports, "orc_render_mesh", renderMeshFn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
