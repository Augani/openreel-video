// The plugin editor window (IPlugView) of ui mode. macOS only; other platforms get a stub that reports "not supported".
#pragma once
#include <functional>
#include <string>

namespace Steinberg { namespace Vst { class IEditController; } }

namespace ui {

bool supported();
/** Runs the platform event loop on the calling (main) thread. Does not return. */
[[noreturn]] void runMainLoop();
/** Queues `fn` on the main thread. */
void runOnMain(std::function<void()> fn);
/**
 * Main thread only. Creates the controller's editor view and puts it in a window. Calls onOpened(width, height) or
 * onError(message); onClosedByUser fires when the user closes the window (not for close()).
 */
void open(Steinberg::Vst::IEditController* controller, const std::string& title, std::function<void(int, int)> onOpened,
          std::function<void(const std::string&)> onError, std::function<void()> onClosedByUser);
/** Main thread only. Detaches the view and closes the window. */
void close();

} // namespace ui
