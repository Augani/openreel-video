cmake_minimum_required(VERSION 3.20)
project(openreel_creation_core LANGUAGES CXX VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(creation_core SHARED src/creation_core.cpp)
target_include_directories(creation_core PUBLIC include)
set_target_properties(creation_core PROPERTIES
  BUILD_RPATH "@loader_path"
  INSTALL_RPATH "@loader_path"
)

# Native desktop build produces a shared library loaded by @openreel/creation-bindings.
# WASM build (emscripten): exposes the C ABI to the browser/desktop WASM bridge.
if(EMSCRIPTEN)
  set_target_properties(creation_core PROPERTIES
    LINK_FLAGS "-s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORTED_FUNCTIONS=['_orc_version','_orc_bake_box','_orc_render_mesh_rgba'] -s EXPORTED_RUNTIME_METHODS=['ccall','cwrap']")
endif()

install(TARGETS creation_core)
install(FILES include/creation_core.h DESTINATION include)

add_executable(creation_aurora_renderer src/aurora_renderer.cpp)
target_include_directories(creation_aurora_renderer PRIVATE include)
target_link_libraries(creation_aurora_renderer PRIVATE creation_core)
set_target_properties(creation_aurora_renderer PROPERTIES
  BUILD_RPATH "@executable_path"
  INSTALL_RPATH "@executable_path"
)

enable_testing()
add_executable(creation_core_test tests/test_creation_core.cpp)
target_include_directories(creation_core_test PRIVATE include)
target_link_libraries(creation_core_test PRIVATE creation_core)
add_test(NAME creation_core_test COMMAND creation_core_test)
add_test(NAME creation_aurora_renderer_self_test COMMAND creation_aurora_renderer --self-test)
