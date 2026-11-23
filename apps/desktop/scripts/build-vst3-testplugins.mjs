// Builds real VST3 test plugins from the Steinberg SDK's own "adelay" example (MIT) into a temp folder. Used by the VST3 host
// tests. Nothing it produces is committed or shipped.
//
//   node scripts/build-vst3-testplugins.mjs <outDir>          builds every variant, prints the folder holding the .vst3 bundles
//
// Variants (all share adelay's DSP: output[n] = input[n - D], D = max(1, int(delay * sampleRate)), delay normalized 0..1):
//   adelay          the unmodified example
//   adelay_latency  the same plugin reporting 100 samples of latency (getLatencySamples)
//   adelay_ui       the same plugin with a minimal macOS editor (a window that edits "Delay" 300 ms after it opens)
//   adelay_crash    segfaults in process() (a plugin that takes its host down while rendering)
//   adelay_crash_late  renders 60 blocks, then segfaults (passes the scan, dies mid-render)
//   adelay_hang     spins forever in process()
//   adelay_nan      outputs NaN
// Each variant has its own class id, so they can sit in one folder.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureVst3Sdk } from "./lib/vst3sdk.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");

const CID = (n) => `0x${(0x0a0b0c00 + n).toString(16).toUpperCase().padStart(8, "0")}, 0x11223344, 0x55667788, 0x99AABB${(0xc0 + n).toString(16).toUpperCase()}`;
const VARIANTS = [
  { name: "adelay", n: 0 },
  { name: "adelay_latency", n: 1, latency: 100 },
  { name: "adelay_ui", n: 2, ui: true },
  { name: "adelay_crash", n: 3, process: "*static_cast<volatile int*>(nullptr) = 1;" },
  { name: "adelay_crash_late", n: 4, process: "static int calls = 0; if (++calls > 60) *static_cast<volatile int*>(nullptr) = 1;" },
  { name: "adelay_hang", n: 5, process: "volatile int spin = 1; while (spin) {}" },
  { name: "adelay_nan", n: 6, nan: true },
];

function replaceOnce(text, from, to, what) {
  if (!text.includes(from)) throw new Error(`adelay source changed upstream: cannot patch ${what}`);
  return text.replace(from, to);
}

function replaceRegex(text, pattern, to, what) {
  if (!pattern.test(text)) throw new Error(`adelay source changed upstream: cannot patch ${what}`);
  return text.replace(pattern, () => to);
}

export function buildTestPlugins(outDir, { log = console.log } = {}) {
  return ensureVst3Sdk(desktopRoot, log).then((sdk) => {
    if (!sdk) return null;
    if (!spawnSync("cmake", ["--version"]).status === 0) return null;
    const exampleDir = path.join(sdk, "public.sdk", "samples", "vst", "adelay");
    mkdirSync(outDir, { recursive: true });
    const lines = [
      "cmake_minimum_required(VERSION 3.25.0)",
      `set(OPENREEL_VST3_SDK "${sdk.replaceAll("\\", "/")}")`,
      'set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)',
      'set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)',
      'set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)',
      'set(SMTG_CREATE_MODULE_INFO OFF CACHE BOOL "" FORCE)',
      'if(NOT DEFINED ENV{MACOSX_DEPLOYMENT_TARGET})\n  set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")\nendif()',
      'list(APPEND CMAKE_MODULE_PATH "${OPENREEL_VST3_SDK}/cmake/modules")',
      "include(SMTG_VST3_SDK)",
      "project(openreel-vst3-testplugins VERSION 3.8.1 LANGUAGES C CXX OBJCXX)",
      "set(vstsdk_VERSION 3.8.1)",
      "smtg_setup_platform_toolset()",
      "smtg_setup_symbol_visibility()",
      'set(SDK_ROOT "${OPENREEL_VST3_SDK}")',
      "set(public_sdk_SOURCE_DIR ${SDK_ROOT}/public.sdk)",
      "set(pluginterfaces_SOURCE_DIR ${SDK_ROOT}/pluginterfaces)",
      "include_directories(${SDK_ROOT})",
      "smtg_create_lib_base_target()",
      "smtg_create_pluginterfaces_target()",
      "smtg_create_public_sdk_common_target()",
      "smtg_create_public_sdk_target()",
    ];
    for (const v of VARIANTS) {
      const srcDir = path.join(outDir, "src", v.name);
      mkdirSync(srcDir, { recursive: true });
      cpSync(path.join(exampleDir, "source"), srcDir, { recursive: true });
      const edit = (file, fn) => writeFileSync(path.join(srcDir, file), fn(readFileSync(path.join(srcDir, file), "utf8")));
      if (v.n !== 0) {
        edit("adelayids.h", (t) => {
          t = replaceOnce(t, "0x0CDBB669, 0x85D548A9, 0xBFD83719, 0x09D24BB3", CID(v.n * 2), "processor uid");
          return replaceOnce(t, "0x038E7FA9, 0x629A4EAA, 0x8541B889, 0x18E8952C", CID(v.n * 2 + 1), "controller uid");
        });
        edit("factory.cpp", (t) => t.replace('#define stringPluginName "ADelay"', `#define stringPluginName "${v.name}"`));
      }
      if (v.latency) {
        edit("adelayprocessor.h", (t) => replaceOnce(t, "tresult PLUGIN_API process (ProcessData& data) SMTG_OVERRIDE;", `tresult PLUGIN_API process (ProcessData& data) SMTG_OVERRIDE;\n\tuint32 PLUGIN_API getLatencySamples () SMTG_OVERRIDE { return ${v.latency}; }`, "latency"));
      }
      if (v.process) {
        edit("adelayprocessor.cpp", (t) => replaceOnce(t, "tresult PLUGIN_API ADelayProcessor::process (ProcessData& data)\n{", `tresult PLUGIN_API ADelayProcessor::process (ProcessData& data)\n{\n\t${v.process}`, "process hook"));
      }
      if (v.nan) {
        edit("adelayprocessor.cpp", (t) => replaceOnce(t, "outputChannel[sample] = mBuffer[channel][tempBufferPos];", 'outputChannel[sample] = std::nanf ("");', "nan"));
      }
      const extra = [];
      if (v.ui) {
        edit("adelaycontroller.h", (t) => replaceOnce(t, "#if TARGET_OS_IPHONE\n\tIPlugView* PLUGIN_API createView", "#if 1\n\tIPlugView* PLUGIN_API createView", "controller header"));
        edit("adelaycontroller.cpp", (t) =>
          replaceRegex(
            t,
            /#if TARGET_OS_IPHONE\n\/\/-+\nIPlugView\* PLUGIN_API ADelayController::createView[\s\S]*?\n#endif/,
            "}\n}\nSteinberg::IPlugView* createTestEditorView (Steinberg::Vst::EditController*);\nnamespace Steinberg {\nnamespace Vst {\nIPlugView* PLUGIN_API ADelayController::createView (FIDString name)\n{\n\tif (FIDStringsEqual (name, ViewType::kEditor)) return createTestEditorView (this);\n\treturn nullptr;\n}",
            "controller view",
          ));
        cpSync(path.join(here, "..", "native", "vst3host", "testplugin", "editor_mac.mm"), path.join(srcDir, "editor_mac.mm"));
        extra.push("source/editor_mac.mm");
      }
      const target = v.name;
      const sources = ["adelaycontroller.cpp", "adelayprocessor.cpp", "exampletest.cpp", "factory.cpp", ...extra.map((e) => path.basename(e))].map((f) => `"${path.join(srcDir, f).replaceAll("\\", "/")}"`);
      lines.push(
        `smtg_add_vst3plugin(${target} ${sources.join(" ")} "\${SDK_ROOT}/public.sdk/source/vst/utility/test/ringbuffertest.cpp" "\${SDK_ROOT}/public.sdk/source/vst/utility/test/versionparsertest.cpp")`,
        `smtg_target_configure_version_file(${target})`,
        `target_compile_features(${target} PUBLIC cxx_std_17)`,
        `target_link_libraries(${target} PRIVATE sdk)`,
        `target_include_directories(${target} PRIVATE "${srcDir.replaceAll("\\", "/")}")`,
      );
      if (v.ui) lines.push(`target_link_libraries(${target} PRIVATE "-framework AppKit")`, `set_source_files_properties("${path.join(srcDir, "editor_mac.mm").replaceAll("\\", "/")}" PROPERTIES COMPILE_OPTIONS "-fobjc-arc")`);
    }
    writeFileSync(path.join(outDir, "CMakeLists.txt"), lines.join("\n") + "\n");
    const build = path.join(outDir, "build");
    // Quiet unless it fails: the build log is long and only matters then.
    const run = (args) => {
      const result = spawnSync("cmake", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (result.status !== 0) log(`${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").slice(-60).join("\n"));
      return result;
    };
    const hasNinja = spawnSync("ninja", ["--version"]).status === 0;
    if (run(["-S", outDir, "-B", build, ...(hasNinja ? ["-G", "Ninja"] : []), "-DCMAKE_BUILD_TYPE=Release"]).status !== 0) return null;
    if (run(["--build", build, "--config", "Release", "--parallel"]).status !== 0) return null;
    const bundles = path.join(build, "VST3", "Release");
    return existsSync(bundles) ? bundles : null;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: build-vst3-testplugins.mjs <outDir>");
    process.exit(2);
  }
  const folder = await buildTestPlugins(path.resolve(out));
  if (!folder) {
    console.error("[vst3-testplugins] skipped: the SDK or a toolchain is unavailable");
    process.exit(0);
  }
  console.log(folder);
  console.log(readdirSync(folder).join("\n"));
}
