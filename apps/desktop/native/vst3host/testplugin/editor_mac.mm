// Test-only editor for the SDK's "adelay" example (which ships without a desktop editor). Used by
// scripts/build-vst3-testplugins.mjs to build the "adelay-ui" variant that the ui mode tests open. Never shipped.
#import <AppKit/AppKit.h>
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/base/funknownimpl.h"
#include "public.sdk/source/vst/vsteditcontroller.h"

using namespace Steinberg;

namespace {

class TestView final : public U::Implements<U::Directly<IPlugView>> {
public:
    explicit TestView(Vst::EditController* c) : controller(c) {}
    tresult PLUGIN_API isPlatformTypeSupported(FIDString type) override { return strcmp(type, kPlatformTypeNSView) == 0 ? kResultTrue : kResultFalse; }
    tresult PLUGIN_API attached(void* parent, FIDString) override {
        NSView* host = (__bridge NSView*)parent;
        NSTextField* label = [NSTextField labelWithString:@"ADelay test editor"];
        label.frame = NSMakeRect(20, 50, 260, 24);
        [host addSubview:label];
        // Simulate the user dragging the Delay knob shortly after the editor opens: a real edit through the component handler.
        Vst::EditController* ctl = controller;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            ctl->beginEdit(100);
            ctl->setParamNormalized(100, 0.25);
            ctl->performEdit(100, 0.25);
            ctl->endEdit(100);
        });
        return kResultTrue;
    }
    tresult PLUGIN_API removed() override { return kResultTrue; }
    tresult PLUGIN_API onWheel(float) override { return kResultFalse; }
    tresult PLUGIN_API onKeyDown(char16, int16, int16) override { return kResultFalse; }
    tresult PLUGIN_API onKeyUp(char16, int16, int16) override { return kResultFalse; }
    tresult PLUGIN_API getSize(ViewRect* size) override { *size = ViewRect(0, 0, 300, 120); return kResultTrue; }
    tresult PLUGIN_API onSize(ViewRect*) override { return kResultTrue; }
    tresult PLUGIN_API onFocus(TBool) override { return kResultTrue; }
    tresult PLUGIN_API setFrame(IPlugFrame*) override { return kResultTrue; }
    tresult PLUGIN_API canResize() override { return kResultFalse; }
    tresult PLUGIN_API checkSizeConstraint(ViewRect*) override { return kResultTrue; }
private:
    Vst::EditController* controller;
};

} // namespace

Steinberg::IPlugView* createTestEditorView(Steinberg::Vst::EditController* controller) { return new TestView(controller); }
