#include "creation_core.h"

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

namespace {
constexpr char kRequestMagic[8] = {'O', 'R', 'A', 'R', 'Q', '1', '\0', '\0'};
constexpr char kResponseMagic[8] = {'O', 'R', 'A', 'R', 'S', '1', '\0', '\0'};

struct RenderRequest {
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<float> colors;
  std::vector<uint32_t> indices;
  orc_render_options options{};
};

struct RenderResponse {
  orc_render_stats stats{};
  double render_ms = 0.0;
  std::vector<uint8_t> rgba;
};

template <typename T>
bool readValue(std::ifstream& input, T* out, std::string* error) {
  input.read(reinterpret_cast<char*>(out), sizeof(T));
  if (input.gcount() != static_cast<std::streamsize>(sizeof(T))) {
    if (error) *error = "Unexpected end of file while reading value";
    return false;
  }
  return true;
}

template <typename T>
bool readValue(std::istream& input, T* out, std::string* error) {
  input.read(reinterpret_cast<char*>(out), sizeof(T));
  if (input.gcount() != static_cast<std::streamsize>(sizeof(T))) {
    if (error) *error = "Unexpected end of stream while reading value";
    return false;
  }
  return true;
}

template <typename T>
bool writeValue(std::ofstream& output, const T& value, std::string* error) {
  output.write(reinterpret_cast<const char*>(&value), sizeof(T));
  if (!output.good()) {
    if (error) *error = "Failed to write value";
    return false;
  }
  return true;
}

template <typename T>
bool writeValue(std::ostream& output, const T& value, std::string* error) {
  output.write(reinterpret_cast<const char*>(&value), sizeof(T));
  if (!output.good()) {
    if (error) *error = "Failed to write value";
    return false;
  }
  return true;
}

bool readBytes(std::ifstream& input, char* data, size_t size, std::string* error) {
  input.read(data, static_cast<std::streamsize>(size));
  if (input.gcount() != static_cast<std::streamsize>(size)) {
    if (error) *error = "Unexpected end of file while reading bytes";
    return false;
  }
  return true;
}

bool readBytes(std::istream& input, char* data, size_t size, std::string* error) {
  input.read(data, static_cast<std::streamsize>(size));
  if (input.gcount() != static_cast<std::streamsize>(size)) {
    if (error) *error = "Unexpected end of stream while reading bytes";
    return false;
  }
  return true;
}

template <typename T>
bool readVector(std::ifstream& input,
                int32_t count,
                std::vector<T>* out,
                std::string* error) {
  if (count < 0) {
    if (error) *error = "Negative vector length";
    return false;
  }
  const auto size = static_cast<size_t>(count);
  if (size > (std::numeric_limits<size_t>::max() / sizeof(T))) {
    if (error) *error = "Vector length overflow";
    return false;
  }
  out->assign(size, T{});
  if (size == 0) return true;
  return readBytes(input, reinterpret_cast<char*>(out->data()), size * sizeof(T), error);
}

template <typename T>
bool readVector(std::istream& input,
                int32_t count,
                std::vector<T>* out,
                std::string* error) {
  if (count < 0) {
    if (error) *error = "Negative vector length";
    return false;
  }
  const auto size = static_cast<size_t>(count);
  if (size > (std::numeric_limits<size_t>::max() / sizeof(T))) {
    if (error) *error = "Vector length overflow";
    return false;
  }
  out->assign(size, T{});
  if (size == 0) return true;
  return readBytes(input, reinterpret_cast<char*>(out->data()), size * sizeof(T), error);
}

template <typename T>
bool writeVector(std::ofstream& output,
                 const std::vector<T>& values,
                 std::string* error) {
  if (!values.empty()) {
    output.write(reinterpret_cast<const char*>(values.data()),
                 static_cast<std::streamsize>(values.size() * sizeof(T)));
    if (!output.good()) {
      if (error) *error = "Failed to write vector";
      return false;
    }
  }
  return true;
}

template <typename T>
bool writeVector(std::ostream& output,
                 const std::vector<T>& values,
                 std::string* error) {
  if (!values.empty()) {
    output.write(reinterpret_cast<const char*>(values.data()),
                 static_cast<std::streamsize>(values.size() * sizeof(T)));
    if (!output.good()) {
      if (error) *error = "Failed to write vector";
      return false;
    }
  }
  return true;
}

template <typename InputStream>
bool readRequestStream(InputStream& input,
                       RenderRequest* out,
                       std::string* error) {
  char magic[8]{};
  if (!readBytes(input, magic, sizeof(magic), error)) return false;
  for (size_t index = 0; index < sizeof(magic); index += 1) {
    if (magic[index] != kRequestMagic[index]) {
      if (error) *error = "Invalid request file magic";
      return false;
    }
  }

  int32_t position_count = 0;
  int32_t normal_count = 0;
  int32_t color_count = 0;
  int32_t index_count = 0;

  if (!readValue(input, &out->options.width, error) ||
      !readValue(input, &out->options.height, error) ||
      !readValue(input, &position_count, error) ||
      !readValue(input, &normal_count, error) ||
      !readValue(input, &color_count, error) ||
      !readValue(input, &index_count, error) ||
      !readBytes(input, reinterpret_cast<char*>(out->options.camera.position),
                 sizeof(out->options.camera.position), error) ||
      !readBytes(input, reinterpret_cast<char*>(out->options.camera.target),
                 sizeof(out->options.camera.target), error) ||
      !readBytes(input, reinterpret_cast<char*>(out->options.camera.up),
                 sizeof(out->options.camera.up), error) ||
      !readValue(input, &out->options.camera.fov_degrees, error) ||
      !readBytes(input, reinterpret_cast<char*>(out->options.light.direction),
                 sizeof(out->options.light.direction), error) ||
      !readValue(input, &out->options.light.ambient, error) ||
      !readValue(input, &out->options.light.intensity, error) ||
      !readBytes(input, reinterpret_cast<char*>(out->options.base_color),
                 sizeof(out->options.base_color), error) ||
      !readBytes(input, reinterpret_cast<char*>(out->options.background),
                 sizeof(out->options.background), error) ||
      !readValue(input, &out->options.shadows, error)) {
    return false;
  }

  if (!readVector(input, position_count, &out->positions, error) ||
      !readVector(input, normal_count, &out->normals, error) ||
      !readVector(input, color_count, &out->colors, error) ||
      !readVector(input, index_count, &out->indices, error)) {
    return false;
  }

  return true;
}

template <typename OutputStream>
bool writeRequestStream(OutputStream& output,
                        const RenderRequest& request,
                        std::string* error) {
  output.write(kRequestMagic, sizeof(kRequestMagic));
  if (!output.good()) {
    if (error) *error = "Failed to write request magic";
    return false;
  }

  const int32_t position_count = static_cast<int32_t>(request.positions.size());
  const int32_t normal_count = static_cast<int32_t>(request.normals.size());
  const int32_t color_count = static_cast<int32_t>(request.colors.size());
  const int32_t index_count = static_cast<int32_t>(request.indices.size());

  if (!writeValue(output, request.options.width, error) ||
      !writeValue(output, request.options.height, error) ||
      !writeValue(output, position_count, error) ||
      !writeValue(output, normal_count, error) ||
      !writeValue(output, color_count, error) ||
      !writeValue(output, index_count, error) ||
      !writeVector(output,
                   std::vector<float>(request.options.camera.position,
                                      request.options.camera.position + 3),
                   error) ||
      !writeVector(output,
                   std::vector<float>(request.options.camera.target,
                                      request.options.camera.target + 3),
                   error) ||
      !writeVector(output,
                   std::vector<float>(request.options.camera.up,
                                      request.options.camera.up + 3),
                   error) ||
      !writeValue(output, request.options.camera.fov_degrees, error) ||
      !writeVector(output,
                   std::vector<float>(request.options.light.direction,
                                      request.options.light.direction + 3),
                   error) ||
      !writeValue(output, request.options.light.ambient, error) ||
      !writeValue(output, request.options.light.intensity, error) ||
      !writeVector(output,
                   std::vector<float>(request.options.base_color,
                                      request.options.base_color + 3),
                   error) ||
      !writeVector(output,
                   std::vector<float>(request.options.background,
                                      request.options.background + 3),
                   error) ||
      !writeValue(output, request.options.shadows, error) ||
      !writeVector(output, request.positions, error) ||
      !writeVector(output, request.normals, error) ||
      !writeVector(output, request.colors, error) ||
      !writeVector(output, request.indices, error)) {
    return false;
  }

  return true;
}

template <typename OutputStream>
bool writeResponseStream(OutputStream& output,
                         const RenderResponse& response,
                         std::string* error) {
  output.write(kResponseMagic, sizeof(kResponseMagic));
  if (!output.good()) {
    if (error) *error = "Failed to write response magic";
    return false;
  }

  const int32_t rgba_length = static_cast<int32_t>(response.rgba.size());
  if (!writeValue(output, response.stats.width, error) ||
      !writeValue(output, response.stats.height, error) ||
      !writeValue(output, response.stats.covered_pixels, error) ||
      !writeValue(output, response.stats.shadowed_pixels, error) ||
      !writeValue(output, response.render_ms, error) ||
      !writeValue(output, rgba_length, error) ||
      !writeVector(output, response.rgba, error)) {
    return false;
  }

  return true;
}

template <typename InputStream>
bool readResponseStream(InputStream& input,
                        RenderResponse* out,
                        std::string* error) {
  char magic[8]{};
  if (!readBytes(input, magic, sizeof(magic), error)) return false;
  for (size_t index = 0; index < sizeof(magic); index += 1) {
    if (magic[index] != kResponseMagic[index]) {
      if (error) *error = "Invalid response file magic";
      return false;
    }
  }

  int32_t rgba_length = 0;
  if (!readValue(input, &out->stats.width, error) ||
      !readValue(input, &out->stats.height, error) ||
      !readValue(input, &out->stats.covered_pixels, error) ||
      !readValue(input, &out->stats.shadowed_pixels, error) ||
      !readValue(input, &out->render_ms, error) ||
      !readValue(input, &rgba_length, error)) {
    return false;
  }
  return readVector(input, rgba_length, &out->rgba, error);
}

bool readRequest(const std::filesystem::path& path,
                 RenderRequest* out,
                 std::string* error) {
  std::ifstream input(path, std::ios::binary);
  if (!input.is_open()) {
    if (error) *error = "Could not open request file";
    return false;
  }
  return readRequestStream(input, out, error);
}

bool writeRequest(const std::filesystem::path& path,
                  const RenderRequest& request,
                  std::string* error) {
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output.is_open()) {
    if (error) *error = "Could not open request file for writing";
    return false;
  }
  return writeRequestStream(output, request, error);
}

bool writeResponse(const std::filesystem::path& path,
                   const RenderResponse& response,
                   std::string* error) {
  std::ofstream output(path, std::ios::binary | std::ios::trunc);
  if (!output.is_open()) {
    if (error) *error = "Could not open response file for writing";
    return false;
  }
  return writeResponseStream(output, response, error);
}

bool readResponse(const std::filesystem::path& path,
                  RenderResponse* out,
                  std::string* error) {
  std::ifstream input(path, std::ios::binary);
  if (!input.is_open()) {
    if (error) *error = "Could not open response file";
    return false;
  }
  return readResponseStream(input, out, error);
}

bool renderRequestToResponse(const RenderRequest& request,
                             RenderResponse* out,
                             std::string* error) {
  if (request.options.width <= 0 || request.options.height <= 0) {
    if (error) *error = "Invalid render dimensions";
    return false;
  }

  const int64_t pixel_bytes =
      static_cast<int64_t>(request.options.width) * request.options.height * 4;
  if (pixel_bytes <= 0 ||
      pixel_bytes > std::numeric_limits<int32_t>::max()) {
    if (error) *error = "Render buffer is too large";
    return false;
  }

  out->rgba.assign(static_cast<size_t>(pixel_bytes), 0);
  const auto start = std::chrono::steady_clock::now();
  out->stats = orc_render_mesh_rgba(
      request.positions.data(),
      static_cast<int32_t>(request.positions.size()),
      request.normals.data(),
      static_cast<int32_t>(request.normals.size()),
      request.colors.empty() ? nullptr : request.colors.data(),
      static_cast<int32_t>(request.colors.size()),
      request.indices.data(),
      static_cast<int32_t>(request.indices.size()),
      &request.options,
      out->rgba.data(),
      static_cast<int32_t>(out->rgba.size()));
  const auto end = std::chrono::steady_clock::now();
  out->render_ms = std::chrono::duration<double, std::milli>(end - start).count();
  return true;
}

bool runRender(const std::filesystem::path& request_path,
               const std::filesystem::path& response_path,
               std::string* error) {
  RenderRequest request;
  if (!readRequest(request_path, &request, error)) return false;
  RenderResponse response;
  if (!renderRequestToResponse(request, &response, error)) return false;
  return writeResponse(response_path, response, error);
}

bool servePayload(const std::string& request_payload,
                  std::string* response_payload,
                  std::string* error) {
  std::istringstream request_stream(request_payload, std::ios::in | std::ios::binary);
  RenderRequest request;
  if (!readRequestStream(request_stream, &request, error)) return false;

  RenderResponse response;
  if (!renderRequestToResponse(request, &response, error)) return false;

  std::ostringstream response_stream(std::ios::out | std::ios::binary);
  if (!writeResponseStream(response_stream, response, error)) return false;
  *response_payload = response_stream.str();
  return true;
}

bool runServe(std::string* error) {
  while (true) {
    uint32_t payload_size = 0;
    std::cin.read(reinterpret_cast<char*>(&payload_size), sizeof(payload_size));
    if (std::cin.gcount() == 0) {
      return true;
    }
    if (std::cin.gcount() != static_cast<std::streamsize>(sizeof(payload_size))) {
      if (error) *error = "Unexpected end of stream while reading request size";
      return false;
    }
    if (payload_size == 0) {
      continue;
    }
    std::string payload(payload_size, '\0');
    if (!readBytes(std::cin, payload.data(), payload.size(), error)) {
      return false;
    }

    std::string response_bytes;
    if (!servePayload(payload, &response_bytes, error)) return false;
    const uint32_t response_size = static_cast<uint32_t>(response_bytes.size());
    std::cout.write(reinterpret_cast<const char*>(&response_size), sizeof(response_size));
    std::cout.write(response_bytes.data(), static_cast<std::streamsize>(response_bytes.size()));
    std::cout.flush();
    if (!std::cout.good()) {
      if (error) *error = "Failed to write served response";
      return false;
    }
  }
}

RenderRequest selfTestRequest() {
  RenderRequest request;
  request.positions = {
      -1.0f, -1.0f, 0.0f,
       1.0f, -1.0f, 0.0f,
       0.0f,  1.0f, 0.0f,
  };
  request.normals = {
      0.0f, 0.0f, 1.0f,
      0.0f, 0.0f, 1.0f,
      0.0f, 0.0f, 1.0f,
  };
  request.indices = {0, 1, 2};
  request.options.width = 48;
  request.options.height = 48;
  request.options.camera.position[0] = 0.0f;
  request.options.camera.position[1] = 0.0f;
  request.options.camera.position[2] = 3.0f;
  request.options.camera.target[0] = 0.0f;
  request.options.camera.target[1] = 0.0f;
  request.options.camera.target[2] = 0.0f;
  request.options.camera.up[0] = 0.0f;
  request.options.camera.up[1] = 1.0f;
  request.options.camera.up[2] = 0.0f;
  request.options.camera.fov_degrees = 40.0f;
  request.options.light.direction[0] = 0.4f;
  request.options.light.direction[1] = 0.9f;
  request.options.light.direction[2] = 0.5f;
  request.options.light.ambient = 0.2f;
  request.options.light.intensity = 0.9f;
  request.options.base_color[0] = 0.23f;
  request.options.base_color[1] = 0.51f;
  request.options.base_color[2] = 0.96f;
  request.options.background[0] = 0.06f;
  request.options.background[1] = 0.09f;
  request.options.background[2] = 0.16f;
  request.options.shadows = 1;
  return request;
}

bool runSelfTest(std::string* error) {
  const auto suffix = std::to_string(
      std::chrono::steady_clock::now().time_since_epoch().count());
  const auto request_path =
      std::filesystem::temp_directory_path() /
      ("openreel-aurora-request-" + suffix + ".bin");
  const auto response_path =
      std::filesystem::temp_directory_path() /
      ("openreel-aurora-response-" + suffix + ".bin");

  const auto cleanup = [&]() {
    std::error_code ignored;
    std::filesystem::remove(request_path, ignored);
    std::filesystem::remove(response_path, ignored);
  };

  if (!writeRequest(request_path, selfTestRequest(), error)) {
    cleanup();
    return false;
  }
  if (!runRender(request_path, response_path, error)) {
    cleanup();
    return false;
  }

  RenderResponse response;
  if (!readResponse(response_path, &response, error)) {
    cleanup();
    return false;
  }
  cleanup();

  if (response.stats.width != 48 || response.stats.height != 48) {
    if (error) *error = "Unexpected render dimensions in self-test";
    return false;
  }
  if (response.stats.covered_pixels <= 0) {
    if (error) *error = "Self-test render produced no covered pixels";
    return false;
  }
  if (response.rgba.size() != static_cast<size_t>(48 * 48 * 4)) {
    if (error) *error = "Self-test render returned an unexpected RGBA size";
    return false;
  }

  std::ostringstream request_stream(std::ios::out | std::ios::binary);
  if (!writeRequestStream(request_stream, selfTestRequest(), error)) {
    return false;
  }
  std::string served_response_bytes;
  if (!servePayload(request_stream.str(), &served_response_bytes, error)) {
    return false;
  }
  std::istringstream served_response_stream(
      served_response_bytes, std::ios::in | std::ios::binary);
  RenderResponse served_response;
  if (!readResponseStream(served_response_stream, &served_response, error)) {
    return false;
  }
  if (served_response.stats.covered_pixels <= 0) {
    if (error) *error = "Self-test serve round-trip produced no covered pixels";
    return false;
  }
  return true;
}
}  // namespace

int main(int argc, char** argv) {
  std::string error;
  if (argc == 2 && std::string(argv[1]) == "--self-test") {
    if (!runSelfTest(&error)) {
      std::cerr << error << "\n";
      return 1;
    }
    return 0;
  }

  if (argc == 2 && std::string(argv[1]) == "serve") {
    if (!runServe(&error)) {
      std::cerr << error << "\n";
      return 1;
    }
    return 0;
  }

  if (argc != 4 || std::string(argv[1]) != "render") {
    std::cerr
        << "usage: creation_aurora_renderer render <request.bin> <response.bin>\n"
        << "   or: creation_aurora_renderer serve\n";
    return 1;
  }

  if (!runRender(argv[2], argv[3], &error)) {
    std::cerr << error << "\n";
    return 1;
  }
  return 0;
}
