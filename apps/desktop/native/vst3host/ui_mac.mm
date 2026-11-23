// macOS editor window for a VST3 plugin: the controller's IPlugView is attached to an NSView inside an NSWindow.
#import <AppKit/AppKit.h>
#include "ui.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/base/funknownimpl.h"

using namespace Steinberg;

@interface OpenReelWindowDelegate : NSObject <NSWindowDelegate>
@property(nonatomic, copy) void (^onClose)(void);
@end
@implementation OpenReelWindowDelegate
- (void)windowWillClose:(NSNotification*)notification {
    if (self.onClose) self.onClose();
}
@end

namespace {

struct State {
    NSWindow* window = nil;
    OpenReelWindowDelegate* delegate = nil;
    IPtr<IPlugView> view;
    std::function<void()> onClosedByUser;
    bool closing = false;
};
State g;

class Frame final : public U::Implements<U::Directly<IPlugFrame>> {
public:
    tresult PLUGIN_API resizeView(IPlugView* v, ViewRect* newSize) override {
        if (!g.window || !newSize) return kResultFalse;
        NSSize size = NSMakeSize(newSize->getWidth(), newSize->getHeight());
        NSRect content = [g.window contentRectForFrameRect:g.window.frame];
        content.origin.y += content.size.height - size.height;
        content.size = size;
        [g.window setFrame:[g.window frameRectForContentRect:content] display:YES];
        ViewRect current{};
        if (v->getSize(&current) == kResultTrue && (current.getWidth() != newSize->getWidth() || current.getHeight() != newSize->getHeight())) v->onSize(newSize);
        return kResultTrue;
    }
};
IPtr<Frame> gFrame;

} // namespace

namespace ui {

bool supported() { return true; }

[[noreturn]] void runMainLoop() {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp run];
    std::exit(0);
}

void runOnMain(std::function<void()> fn) {
    auto* box = new std::function<void()>(std::move(fn));
    dispatch_async(dispatch_get_main_queue(), ^{
        (*box)();
        delete box;
    });
}

void close() {
    if (!g.window) return;
    g.closing = true;
    NSWindow* win = g.window;
    g.window = nil;
    win.delegate = nil;
    if (g.view) { g.view->setFrame(nullptr); g.view->removed(); g.view = nullptr; }
    [win close];
    g.delegate = nil;
    g.closing = false;
}

void open(Vst::IEditController* controller, const std::string& title, std::function<void(int, int)> onOpened,
          std::function<void(const std::string&)> onError, std::function<void()> onClosedByUser) {
    close();
    IPtr<IPlugView> view = owned(controller->createView(Vst::ViewType::kEditor));
    if (!view) { onError("the plugin has no editor window"); return; }
    if (view->isPlatformTypeSupported(kPlatformTypeNSView) != kResultTrue) { onError("the plugin editor does not support NSView hosting"); return; }
    ViewRect rect{};
    if (view->getSize(&rect) != kResultTrue || rect.getWidth() < 10 || rect.getHeight() < 10) { rect.left = 0; rect.top = 0; rect.right = 420; rect.bottom = 320; }
    NSRect frame = NSMakeRect(0, 0, rect.getWidth(), rect.getHeight());
    NSWindow* win = [[NSWindow alloc] initWithContentRect:frame styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable) backing:NSBackingStoreBuffered defer:NO];
    win.title = [NSString stringWithUTF8String:title.c_str()];
    win.releasedWhenClosed = NO;
    NSView* content = [[NSView alloc] initWithFrame:frame];
    win.contentView = content;
    if (!gFrame) gFrame = owned(new Frame());
    g.window = win;
    g.view = view;
    g.onClosedByUser = std::move(onClosedByUser);
    view->setFrame(gFrame);
    if (view->attached((__bridge void*)content, kPlatformTypeNSView) != kResultTrue) {
        g.window = nil; g.view->setFrame(nullptr); g.view = nullptr;
        onError("the plugin editor could not be attached to a window");
        return;
    }
    ViewRect after{};
    if (view->getSize(&after) == kResultTrue && after.getWidth() > 10 && (after.getWidth() != rect.getWidth() || after.getHeight() != rect.getHeight())) {
        rect = after;
        [win setContentSize:NSMakeSize(rect.getWidth(), rect.getHeight())];
    }
    OpenReelWindowDelegate* delegate = [[OpenReelWindowDelegate alloc] init];
    delegate.onClose = ^{
        if (g.closing) return;
        auto cb = g.onClosedByUser;
        if (g.view) { g.view->setFrame(nullptr); g.view->removed(); g.view = nullptr; }
        g.window = nil;
        if (cb) cb();
    };
    g.delegate = delegate;
    win.delegate = delegate;
    [win center];
    [win makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    onOpened(static_cast<int>(rect.getWidth()), static_cast<int>(rect.getHeight()));
}

} // namespace ui
