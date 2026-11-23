#include "ui.h"
#include <chrono>
#include <thread>

namespace ui {
bool supported() { return false; }
[[noreturn]] void runMainLoop() { for (;;) std::this_thread::sleep_for(std::chrono::hours(24)); }
void runOnMain(std::function<void()> fn) { fn(); }
void open(Steinberg::Vst::IEditController*, const std::string&, std::function<void(int, int)>, std::function<void(const std::string&)> onError, std::function<void()>) {
    onError("plugin windows are only supported on macOS in this build");
}
void close() {}
} // namespace ui
