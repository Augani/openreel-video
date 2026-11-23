// openreel-vst3host: the out-of-process VST3 plugin host.
//
// The editor never loads third-party plugin code. This helper does, in its own process, so a plugin that crashes, hangs or
// corrupts memory takes the helper down and nothing else. It speaks the same framed protocol, with the same messages and
// modes, as the Audio Unit helper (apps/desktop/native/plughost/main.swift, wire format in
// apps/desktop/src/shared/plughost-protocol.ts):
//
//   serve    framed protocol: hello / list / probe / open / block / getState / setState / close
//   ui       like serve, plus a native window for the plugin's own editor (ui-open, ui-set, ui-close; macOS)
//   offline  command line render of a raw planar float32 file, the reference the editor's own pipe render is checked against
//
// Parameters are exposed as normalized values 0..1 (min 0, max 1), keyed by the VST3 parameter id. Built against the MIT
// licensed Steinberg VST3 SDK hosting classes (fetched by scripts/build-vst3host.mjs, never committed).
#ifdef __APPLE__
#include <pthread/qos.h>
#endif
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
#include <vector>

#include "json.h"
#include "protocol.h"
#include "ui.h"

#include "base/source/fstreamer.h"
#include "pluginterfaces/base/funknownimpl.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vstspeaker.h"
#include "public.sdk/source/common/memorystream.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/utility/stringconvert.h"

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace {

constexpr const char* kHelperName = "openreel-vst3host";
constexpr const char* kHelperVersion = "1.0.0";

struct HostError {
    std::string message;
};

const char* platformName() {
#if defined(__APPLE__)
    return "darwin";
#elif defined(_WIN32)
    return "win32";
#else
    return "linux";
#endif
}

// MARK: base64 (the state chunk travels as base64 text, like the AU helper's property list)

const char kB64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

std::string b64encode(const std::vector<uint8_t>& in) {
    std::string out;
    out.reserve((in.size() + 2) / 3 * 4);
    size_t i = 0;
    for (; i + 2 < in.size(); i += 3) {
        uint32_t v = (in[i] << 16) | (in[i + 1] << 8) | in[i + 2];
        out += kB64[v >> 18]; out += kB64[(v >> 12) & 63]; out += kB64[(v >> 6) & 63]; out += kB64[v & 63];
    }
    if (i + 1 == in.size()) {
        uint32_t v = in[i] << 16;
        out += kB64[v >> 18]; out += kB64[(v >> 12) & 63]; out += "==";
    } else if (i + 2 == in.size()) {
        uint32_t v = (in[i] << 16) | (in[i + 1] << 8);
        out += kB64[v >> 18]; out += kB64[(v >> 12) & 63]; out += kB64[(v >> 6) & 63]; out += '=';
    }
    return out;
}

bool b64decode(const std::string& in, std::vector<uint8_t>& out) {
    out.clear();
    uint32_t acc = 0; int bits = 0;
    for (char c : in) {
        if (c == '=' || c == '\n' || c == '\r' || c == ' ') continue;
        const char* p = std::strchr(kB64, c);
        if (!p || c == '\0') return false;
        acc = (acc << 6) | static_cast<uint32_t>(p - kB64); bits += 6;
        if (bits >= 8) { bits -= 8; out.push_back(static_cast<uint8_t>((acc >> bits) & 255)); }
    }
    return true;
}

std::string utf8(const TChar* s) { return VST3::StringConvert::convert(std::u16string(reinterpret_cast<const char16_t*>(s))); }

// MARK: host context

HostApplication& hostApp() {
    static HostApplication app;
    return app;
}

/** The host side of the controller: edits the plugin makes itself (its own editor, its own restarts) arrive here. */
class Handler final : public U::Implements<U::Directly<IComponentHandler>> {
public:
    std::function<void(ParamID, double)> onEdit;
    std::atomic<bool> latencyChanged{false};
    tresult PLUGIN_API beginEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API performEdit(ParamID id, ParamValue value) override {
        if (onEdit) onEdit(id, value);
        return kResultOk;
    }
    tresult PLUGIN_API endEdit(ParamID) override { return kResultOk; }
    tresult PLUGIN_API restartComponent(int32 flags) override {
        if (flags & kLatencyChanged) latencyChanged = true;
        return kResultOk;
    }
};

std::vector<VST3::Hosting::Module::Ptr>& loadedModules() {
    static std::vector<VST3::Hosting::Module::Ptr> modules; // never unloaded: unloading a plugin library is where plugins crash on exit
    return modules;
}

bool contains(const std::string& hay, const char* needle) { return hay.find(needle) != std::string::npos; }

SpeakerArrangement arrangementFor(int channels) {
    switch (channels) {
        case 1: return SpeakerArr::kMono;
        case 2: return SpeakerArr::kStereo;
        case 3: return SpeakerArr::k30Cine;
        case 4: return SpeakerArr::k40Music;
        case 5: return SpeakerArr::k50;
        case 6: return SpeakerArr::k51;
        case 8: return SpeakerArr::k71CineFullFront;
        default: return 0;
    }
}

// MARK: plugin instance

class Plugin {
public:
    std::string id;
    std::string classId;
    std::string name, vendor, version, category;
    double sampleRate = 48000;
    int channels = 2;
    int maxBlock = 512;
    IPtr<Handler> handler;
    IPtr<IComponent> component;
    IPtr<IEditController> controller;
    std::vector<ParameterInfo> infos; // exposed parameters
    std::map<std::string, size_t> byKey;
    int64_t position = 0;

    Plugin(const std::string& pluginId, const std::string& path) : id(pluginId) {
        if (path.empty()) throw HostError{"open needs the path of the .vst3 bundle"};
        PluginContextFactory::instance().setPluginContext(&hostApp());
        std::string err;
        auto module = VST3::Hosting::Module::create(path, err);
        if (!module) throw HostError{"the plugin bundle could not be loaded: " + (err.empty() ? std::string("unknown error") : err)};
        loadedModules().push_back(module);
        module->getFactory().setHostContext(&hostApp());
        auto classes = module->getFactory().classInfos();
        std::string wanted = id.rfind("vst3:", 0) == 0 ? id.substr(5) : id;
        std::transform(wanted.begin(), wanted.end(), wanted.begin(), ::toupper);
        const VST3::Hosting::ClassInfo* chosen = nullptr;
        const VST3::Hosting::ClassInfo* firstFx = nullptr;
        const VST3::Hosting::ClassInfo* firstAudio = nullptr;
        bool sawInstrument = false;
        for (const auto& c : classes) {
            if (c.category() != "Audio Module Class") continue;
            if (!firstAudio) firstAudio = &c;
            bool fx = contains(c.subCategoriesString(), "Fx");
            if (contains(c.subCategoriesString(), "Instrument") && !fx) sawInstrument = true;
            if (fx && !firstFx) firstFx = &c;
            std::string cid = c.ID().toString(false);
            std::transform(cid.begin(), cid.end(), cid.begin(), ::toupper);
            if (cid == wanted) chosen = &c;
        }
        // The editor derives a provisional id from the bundle path when it cannot read the class id without loading code:
        // the class id reported by probe replaces it. Open with an id that matches no class falls back to the first effect.
        if (!chosen) chosen = firstFx;
        if (!chosen && !sawInstrument) chosen = firstAudio;
        if (!chosen) throw HostError{sawInstrument ? "the bundle only contains instruments; only audio effects can be hosted" : "the bundle contains no audio effect class"};
        if (contains(chosen->subCategoriesString(), "Instrument") && !contains(chosen->subCategoriesString(), "Fx")) throw HostError{"the plugin is an instrument; only audio effects can be hosted"};
        std::string cidText = chosen->ID().toString(false);
        std::transform(cidText.begin(), cidText.end(), cidText.begin(), ::toupper);
        classId = cidText;
        name = chosen->name(); vendor = chosen->vendor(); version = chosen->version(); category = chosen->subCategoriesString();
        if (vendor.empty()) vendor = module->getFactory().info().vendor();
        auto provider = owned(new PlugProvider(module->getFactory(), *chosen, true));
        if (!provider->initialize()) throw HostError{"the plugin could not be initialised"};
        component = provider->getComponentPtr();
        controller = provider->getControllerPtr();
        provider_ = provider;
        if (!component) throw HostError{"the plugin has no component"};
        processor_ = FUnknownPtr<IAudioProcessor>(component);
        if (!processor_) throw HostError{"the plugin has no audio processor"};
        if (controller) {
            handler = owned(new Handler());
            controller->setComponentHandler(handler);
        }
    }

    ~Plugin() { close(); }

    void configure(double rate, int ch, int block, bool realtime = false) {
        processMode_ = realtime ? kRealtime : kOffline;
        if (active_) deactivate();
        sampleRate = rate; channels = ch; maxBlock = block;
        SpeakerArrangement arrangement = arrangementFor(ch);
        if (arrangement == 0) throw HostError{"the plugin does not accept " + std::to_string(ch) + " channel(s)"};
        int32 nIn = component->getBusCount(kAudio, kInput), nOut = component->getBusCount(kAudio, kOutput);
        if (nIn < 1 || nOut < 1) throw HostError{"the plugin has no audio input or output bus (it is not an effect)"};
        std::vector<SpeakerArrangement> ins(nIn), outs(nOut);
        for (int32 i = 0; i < nIn; i++) { ins[i] = 0; processor_->getBusArrangement(kInput, i, ins[i]); }
        for (int32 i = 0; i < nOut; i++) { outs[i] = 0; processor_->getBusArrangement(kOutput, i, outs[i]); }
        ins[0] = arrangement; outs[0] = arrangement;
        processor_->setBusArrangements(ins.data(), nIn, outs.data(), nOut);
        SpeakerArrangement gotIn = 0, gotOut = 0;
        processor_->getBusArrangement(kInput, 0, gotIn);
        processor_->getBusArrangement(kOutput, 0, gotOut);
        if (SpeakerArr::getChannelCount(gotIn) != ch || SpeakerArr::getChannelCount(gotOut) != ch)
            throw HostError{"the plugin does not accept " + std::to_string(ch) + " channel(s)"};
        component->activateBus(kAudio, kInput, 0, true);
        component->activateBus(kAudio, kOutput, 0, true);
        for (int32 i = 1; i < nIn; i++) component->activateBus(kAudio, kInput, i, false);
        for (int32 i = 1; i < nOut; i++) component->activateBus(kAudio, kOutput, i, false);
        if (processor_->canProcessSampleSize(kSample32) != kResultTrue) throw HostError{"the plugin cannot process 32 bit float audio"};
        ProcessSetup setup{processMode_, kSample32, block, rate};
        if (processor_->setupProcessing(setup) != kResultOk) throw HostError{"the plugin refused setupProcessing at " + std::to_string(static_cast<int>(rate)) + " Hz"};
        if (component->setActive(true) != kResultOk) throw HostError{"the plugin could not be activated"};
        active_ = true;
        if (!data_.prepare(*component, block, kSample32)) throw HostError{"could not allocate the plugin's audio buffers"};
        processor_->setProcessing(true);
        processing_ = true;
        std::memset(&context_, 0, sizeof context_);
        context_.sampleRate = rate;
        context_.tempo = 120.0;
        context_.timeSigNumerator = 4;
        context_.timeSigDenominator = 4;
        context_.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid;
        position = 0;
        collectParameters();
    }

    void collectParameters() {
        infos.clear(); byKey.clear();
        if (!controller) return;
        int32 count = controller->getParameterCount();
        for (int32 i = 0; i < count; i++) {
            ParameterInfo info{};
            if (controller->getParameterInfo(i, info) != kResultTrue) continue;
            // Hidden, read-only (meters) and program-change parameters are not something a clip can automate.
            if (info.flags & (ParameterInfo::kIsHidden | ParameterInfo::kIsReadOnly | ParameterInfo::kIsProgramChange)) continue;
            byKey[std::to_string(info.id)] = infos.size();
            infos.push_back(info);
        }
    }

    int latencySamples() const { return processor_ ? static_cast<int>(processor_->getLatencySamples()) : 0; }
    double tailSeconds() const {
        if (!processor_) return 0;
        uint32 t = processor_->getTailSamples();
        if (t == kInfiniteTail || t == kNoTail) return 0;
        return static_cast<double>(t) / sampleRate;
    }

    json::Value describeParameters() const {
        json::Array out;
        for (const auto& info : infos) {
            json::Object p;
            p["key"] = std::to_string(info.id);
            std::string title = utf8(info.title);
            p["name"] = title.empty() ? utf8(info.shortTitle) : title;
            p["identifier"] = std::to_string(info.id);
            p["min"] = 0.0; p["max"] = 1.0;
            p["value"] = controller ? controller->getParamNormalized(info.id) : info.defaultNormalizedValue;
            p["default"] = info.defaultNormalizedValue;
            p["unit"] = 0;
            p["unitName"] = utf8(info.units);
            p["stepCount"] = info.stepCount;
            p["indexed"] = info.stepCount > 0;
            if (controller) {
                String128 text{};
                if (controller->getParamStringByValue(info.id, controller->getParamNormalized(info.id), text) == kResultTrue) p["display"] = utf8(text);
            }
            out.emplace_back(std::move(p));
        }
        return json::Value(std::move(out));
    }

    void applyParameters(const json::Value& values) {
        if (!values.isObject()) return;
        for (const auto& kv : *values.o) {
            auto it = byKey.find(kv.first);
            if (it == byKey.end() || !kv.second.isNumber()) continue;
            setNormalized(infos[it->second].id, std::min(1.0, std::max(0.0, kv.second.n)), true);
        }
    }

    /** Sets a parameter on the controller and (queue) hands it to the processor with the next process call. */
    void setNormalized(ParamID id, double value, bool queue) {
        if (controller) controller->setParamNormalized(id, value);
        if (!queue) return;
        int32 index = 0;
        if (IParamValueQueue* q = inChanges_.addParameterData(id, index)) { int32 at = 0; q->addPoint(0, value, at); pending_ = true; }
    }

    /** Pushes parameter edits the plugin made itself (its editor) through one silent block so the processor's state follows. */
    void flushEdits(const std::map<ParamID, double>& edits) {
        for (const auto& kv : edits) setNormalized(kv.first, kv.second, true);
        flushPending();
    }

    /**
     * Values set since the last process call only reach the processor with the next block, so its own state (what getState
     * returns) would still be the old one. Before reading the state, hand them over with one silent block. Used at open and
     * when a plugin window closes, never between the blocks of a render.
     */
    void flushPending() {
        if (!pending_ || !active_) return;
        std::vector<float> silence(static_cast<size_t>(channels) * maxBlock, 0.f);
        try { process(maxBlock, silence.data()); } catch (...) {}
    }

    std::vector<float> process(int frames, const float* planarInput) {
        if (frames > maxBlock) throw HostError{"block of " + std::to_string(frames) + " frames exceeds the maximum " + std::to_string(maxBlock)};
        AudioBusBuffers& in = data_.inputs[0];
        AudioBusBuffers& out = data_.outputs[0];
        for (int c = 0; c < channels; c++) std::memcpy(in.channelBuffers32[c], planarInput + static_cast<size_t>(c) * frames, sizeof(float) * frames);
        for (int c = 0; c < channels; c++) std::memset(out.channelBuffers32[c], 0, sizeof(float) * frames);
        in.silenceFlags = 0; out.silenceFlags = 0;
        for (int32 b = 1; b < data_.numInputs; b++) data_.inputs[b].silenceFlags = HostProcessData::kAllChannelsSilent;
        data_.numSamples = frames;
        data_.processMode = processMode_;
        data_.inputParameterChanges = &inChanges_;
        data_.outputParameterChanges = &outChanges_;
        data_.processContext = &context_;
        context_.projectTimeSamples = position;
        context_.continousTimeSamples = position;
        context_.projectTimeMusic = (static_cast<double>(position) / sampleRate) * (context_.tempo / 60.0);
        tresult r = processor_->process(data_);
        inChanges_.clearQueue();
        outChanges_.clearQueue();
        pending_ = false;
        if (r != kResultOk && r != kResultTrue) throw HostError{"the plugin failed to render (result " + std::to_string(r) + ")"};
        position += frames;
        std::vector<float> result(static_cast<size_t>(channels) * frames);
        for (int c = 0; c < channels; c++) std::memcpy(result.data() + static_cast<size_t>(c) * frames, out.channelBuffers32[c], sizeof(float) * frames);
        return result;
    }

    // State chunk: "ORV3" | version u8 | componentLen u32 LE | component | controllerLen u32 LE | controller
    std::string stateBase64() {
        flushPending();
        MemoryStream cs, es;
        std::vector<uint8_t> bytes;
        auto put32 = [&](uint32_t v) { for (int i = 0; i < 4; i++) bytes.push_back((v >> (8 * i)) & 255); };
        if (component->getState(&cs) != kResultOk) return "";
        if (controller) controller->getState(&es);
        bytes.insert(bytes.end(), {'O', 'R', 'V', '3', 1});
        put32(static_cast<uint32_t>(cs.getSize()));
        bytes.insert(bytes.end(), cs.getData(), cs.getData() + cs.getSize());
        put32(static_cast<uint32_t>(es.getSize()));
        bytes.insert(bytes.end(), es.getData(), es.getData() + es.getSize());
        return b64encode(bytes);
    }

    void restore(const std::string& base64) {
        std::vector<uint8_t> b;
        if (!b64decode(base64, b) || b.size() < 13 || std::memcmp(b.data(), "ORV3", 4) != 0 || b[4] != 1) throw HostError{"the saved plugin state is not readable"};
        size_t off = 5;
        auto get32 = [&](uint32_t& v) { if (off + 4 > b.size()) return false; v = b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (static_cast<uint32_t>(b[off + 3]) << 24); off += 4; return true; };
        uint32_t cl = 0, el = 0;
        if (!get32(cl) || off + cl > b.size()) throw HostError{"the saved plugin state is not readable"};
        std::vector<uint8_t> comp(b.begin() + off, b.begin() + off + cl); off += cl;
        if (!get32(el) || off + el > b.size()) throw HostError{"the saved plugin state is not readable"};
        std::vector<uint8_t> ctrl(b.begin() + off, b.begin() + off + el);
        MemoryStream cs(comp.data(), static_cast<TSize>(comp.size()));
        if (component->setState(&cs) == kResultFalse) throw HostError{"the plugin rejected the saved state"};
        if (controller) {
            MemoryStream cs2(comp.data(), static_cast<TSize>(comp.size()));
            controller->setComponentState(&cs2);
            if (!ctrl.empty()) { MemoryStream es(ctrl.data(), static_cast<TSize>(ctrl.size())); controller->setState(&es); }
        }
    }

    /** Clears the plugin's internal history (delay lines, reverb tails): what a host does when the playhead is relocated. */
    void reset() {
        if (!active_) return;
        if (processing_) processor_->setProcessing(false);
        component->setActive(false);
        component->setActive(true);
        if (processing_) processor_->setProcessing(true);
    }

    void deactivate() {
        if (processing_) { processor_->setProcessing(false); processing_ = false; }
        if (active_) { component->setActive(false); active_ = false; }
        data_.unprepare();
    }

    void close() {
        if (closed_) return;
        closed_ = true;
        deactivate();
        if (controller) controller->setComponentHandler(nullptr);
        processor_ = nullptr;
        controller = nullptr;
        component = nullptr;
        provider_ = nullptr; // terminates the plugin; the module itself stays loaded
    }

private:
    IPtr<PlugProvider> provider_;
    FUnknownPtr<IAudioProcessor> processor_;
    HostProcessData data_;
    ParameterChanges inChanges_{64};
    ParameterChanges outChanges_{64};
    ProcessContext context_{};
    int32 processMode_ = kOffline;
    bool active_ = false, processing_ = false, closed_ = false, pending_ = false;
};

std::vector<float> floats(const std::vector<uint8_t>& data) {
    std::vector<float> out(data.size() / 4);
    if (!out.empty()) std::memcpy(out.data(), data.data(), out.size() * 4);
    return out;
}

// MARK: automation (identical math to the editor's TypeScript evaluateLane and the Swift helper)

using Lane = std::vector<std::pair<double, double>>;

bool laneValue(const Lane& lane, double time, double& out) {
    if (lane.empty()) return false;
    if (time <= lane.front().first) { out = lane.front().second; return true; }
    if (time >= lane.back().first) { out = lane.back().second; return true; }
    size_t lo = 0, hi = lane.size() - 1;
    while (hi - lo > 1) { size_t mid = (lo + hi) >> 1; if (lane[mid].first <= time) lo = mid; else hi = mid; }
    const auto& a = lane[lo]; const auto& b = lane[hi];
    double span = b.first - a.first;
    out = span <= 0 ? b.second : a.second + (b.second - a.second) * ((time - a.first) / span);
    return true;
}

std::vector<std::vector<float>> offlineRender(Plugin& plugin, const std::vector<std::vector<float>>& input, const json::Value& base, const std::map<std::string, Lane>& lanes, int block) {
    size_t n = input.empty() ? 0 : input[0].size();
    size_t latency = static_cast<size_t>(std::max(0, plugin.latencySamples()));
    size_t total = n + latency;
    int ch = plugin.channels;
    std::vector<std::vector<float>> output(ch, std::vector<float>(total, 0.f));
    for (size_t start = 0; start < total;) {
        int frames = static_cast<int>(std::min<size_t>(block, total - start));
        std::vector<float> planar(static_cast<size_t>(ch) * frames, 0.f);
        for (int c = 0; c < ch; c++) for (int i = 0; i < frames; i++) if (start + i < n) planar[static_cast<size_t>(c) * frames + i] = input[c][start + i];
        json::Object values = base.isObject() ? *base.o : json::Object{};
        double t = static_cast<double>(start) / plugin.sampleRate;
        for (const auto& kv : lanes) { double v; if (laneValue(kv.second, t, v)) values[kv.first] = v; }
        plugin.applyParameters(json::Value(values));
        auto out = plugin.process(frames, planar.data());
        for (int c = 0; c < ch; c++) for (int i = 0; i < frames; i++) output[c][start + i] = out[static_cast<size_t>(c) * frames + i];
        start += frames;
    }
    std::vector<std::vector<float>> trimmed(ch);
    for (int c = 0; c < ch; c++) trimmed[c].assign(output[c].begin() + latency, output[c].begin() + latency + n);
    return trimmed;
}

// MARK: serve

std::unique_ptr<Plugin> session;
bool uiEnabled = false;
std::unique_ptr<Plugin> uiPlugin; // main thread only
std::map<ParamID, double> uiEdits;

json::Object withType(const std::string& type, json::Object fields, const json::Value& reqId) {
    fields["type"] = type;
    fields["reqId"] = reqId;
    return fields;
}

void handle(const json::Value& j, const std::vector<uint8_t>& binary) {
    std::string type = j.str("type");
    json::Value reqId = j.has("reqId") ? *j.get("reqId") : json::Value(nullptr);
    auto ok = [&](const std::string& t, json::Object fields = {}, const void* bin = nullptr, size_t binLen = 0) { proto::sendFrame(withType(t, std::move(fields), reqId), bin, binLen); };
    auto fail = [&](const std::string& message) { ok("error", {{"message", message}}); };
    try {
        if (type == "hello") {
            ok("ready", {{"protocol", 1}, {"helper", kHelperName}, {"version", kHelperVersion}, {"platform", platformName()}, {"formats", json::Array{json::Value("vst3")}}});
        } else if (type == "list") {
            // VST3 bundles are discovered by the editor (folder walk plus moduleinfo.json) without loading any plugin code,
            // so there is nothing to enumerate in-process here; probe supplies the class id, name and vendor.
            ok("components", {{"components", json::Array{}}});
        } else if (type == "probe") {
            std::string id = j.str("id");
            if (id.empty()) return fail("probe needs an id");
            Plugin plugin(id, j.str("path"));
            plugin.configure(48000, 2, 512);
            uint32_t seed = 12345;
            float worst = 0;
            for (int block = 0; block < 8; block++) {
                std::vector<float> noise(2 * 512);
                for (auto& v : noise) { seed = seed * 1664525u + 1013904223u; v = (static_cast<float>(seed >> 8) / static_cast<float>(1 << 24) - 0.5f) * 0.5f; }
                auto out = plugin.process(512, noise.data());
                for (float v : out) { if (!std::isfinite(v)) throw HostError{"the plugin produced NaN or infinite samples"}; worst = std::max(worst, std::fabs(v)); }
            }
            if (worst > 64) throw HostError{"the plugin produced runaway output (" + std::to_string(worst) + ")"};
            ok("probed", {{"ok", true}, {"latencySamples", plugin.latencySamples()}, {"tailSeconds", plugin.tailSeconds()}, {"parameters", plugin.describeParameters()}, {"peak", static_cast<double>(worst)},
                          {"classId", plugin.classId}, {"name", plugin.name}, {"vendor", plugin.vendor}, {"version", plugin.version}, {"category", plugin.category}});
            plugin.close();
        } else if (type == "open") {
            std::string id = j.str("id");
            if (id.empty()) return fail("open needs an id");
            session.reset();
            auto plugin = std::make_unique<Plugin>(id, j.str("path"));
#ifdef __APPLE__
            // A live insert has a deadline every few milliseconds: ask the scheduler for the interactive class (renders keep the default).
            if (j.boolean("realtime", false)) pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
#endif
            plugin->configure(j.num("sampleRate", 48000), static_cast<int>(j.num("channels", 2)), static_cast<int>(j.num("maxBlock", 512)), j.boolean("realtime", false));
            std::string state = j.str("state");
            if (!state.empty()) plugin->restore(state);
            if (const json::Value* v = j.get("params")) plugin->applyParameters(*v);
            session = std::move(plugin);
            ok("opened", {{"latencySamples", session->latencySamples()}, {"tailSeconds", session->tailSeconds()}, {"parameters", session->describeParameters()}});
        } else if (type == "block") {
            if (!session) return fail("no plugin is open");
            int frames = static_cast<int>(j.num("frames", 0));
            if (const json::Value* v = j.get("params")) session->applyParameters(*v);
            size_t expected = static_cast<size_t>(frames) * session->channels * 4;
            if (binary.size() != expected) return fail("block payload has " + std::to_string(binary.size()) + " bytes, expected " + std::to_string(expected));
            auto in = floats(binary);
            auto out = session->process(frames, in.data());
            ok("blockResult", {{"frames", frames}}, out.data(), out.size() * 4);
        } else if (type == "reset") {
            if (!session) return fail("no plugin is open");
            session->reset();
            ok("reset");
        } else if (type == "getState") {
            if (!session) return fail("no plugin is open");
            std::string s = session->stateBase64();
            ok("state", {{"state", s.empty() ? json::Value(nullptr) : json::Value(s)}, {"parameters", session->describeParameters()}});
        } else if (type == "setState") {
            std::string state = j.str("state");
            if (!session || state.empty()) return fail("setState needs an open plugin and a state");
            session->restore(state);
            ok("stateSet", {{"parameters", session->describeParameters()}});
        } else if (type == "close") {
            session.reset();
            ok("closed");
        } else if (type == "ui-open") {
            if (!uiEnabled) return fail("this helper was not started in ui mode");
            std::string id = j.str("id");
            if (id.empty()) return fail("ui-open needs an id");
            json::Value copy = j;
            ui::runOnMain([copy, id, reqId]() {
                auto err = [&](const std::string& m) { proto::sendFrame(json::Object{{"type", "error"}, {"reqId", reqId}, {"message", m}}); };
                try {
                    if (uiPlugin) { ui::close(); uiPlugin.reset(); }
                    uiEdits.clear();
                    auto plugin = std::make_unique<Plugin>(id, copy.str("path"));
                    plugin->configure(copy.num("sampleRate", 48000), static_cast<int>(copy.num("channels", 2)), 512);
                    std::string state = copy.str("state");
                    if (!state.empty()) plugin->restore(state);
                    if (const json::Value* v = copy.get("params")) plugin->applyParameters(*v);
                    if (!plugin->controller) { err("the plugin has no controller, so no editor"); return; }
                    if (plugin->handler) plugin->handler->onEdit = [](ParamID pid, double value) {
                        uiEdits[pid] = value;
                        proto::sendFrame(json::Object{{"type", "paramChanged"}, {"key", std::to_string(pid)}, {"value", value}});
                    };
                    std::string title = copy.str("title", plugin->name);
                    uiPlugin = std::move(plugin);
                    auto finish = []() {
                        if (!uiPlugin) return;
                        uiPlugin->flushEdits(uiEdits); uiEdits.clear();
                        std::string s = uiPlugin->stateBase64();
                        proto::sendFrame(json::Object{{"type", "uiState"}, {"state", s.empty() ? json::Value(nullptr) : json::Value(s)}, {"parameters", uiPlugin->describeParameters()}});
                        uiPlugin->close(); uiPlugin.reset();
                        proto::sendFrame(json::Object{{"type", "uiClosed"}});
                    };
                    ui::open(uiPlugin->controller, title,
                        [reqId, title](int w, int h) { proto::sendFrame(json::Object{{"type", "uiOpened"}, {"reqId", reqId}, {"width", w}, {"height", h}, {"title", title}}); },
                        [reqId, err](const std::string& m) { err(m); uiPlugin.reset(); },
                        finish);
                } catch (const HostError& e) { err(e.message); uiPlugin.reset(); }
            });
        } else if (type == "ui-set") {
            if (!uiEnabled || !j.has("key") || !j.has("value")) return fail("ui-set needs ui mode, a key and a value");
            std::string key = j.str("key");
            double value = j.num("value", 0);
            ui::runOnMain([key, value]() {
                if (!uiPlugin) return;
                auto it = uiPlugin->byKey.find(key);
                if (it == uiPlugin->byKey.end()) return;
                ParamID pid = uiPlugin->infos[it->second].id;
                double v = std::min(1.0, std::max(0.0, value));
                uiPlugin->setNormalized(pid, v, true);
                uiEdits[pid] = v;
                // The Audio Unit helper's parameter observer fires for a value pushed from the inspector; do the same.
                proto::sendFrame(json::Object{{"type", "paramChanged"}, {"key", key}, {"value", v}});
            });
            ok("ui-set");
        } else if (type == "ui-close") {
            ui::runOnMain([]() {
                if (!uiPlugin) return;
                uiPlugin->flushEdits(uiEdits); uiEdits.clear();
                std::string s = uiPlugin->stateBase64();
                proto::sendFrame(json::Object{{"type", "uiState"}, {"state", s.empty() ? json::Value(nullptr) : json::Value(s)}, {"parameters", uiPlugin->describeParameters()}});
                ui::close();
                uiPlugin->close(); uiPlugin.reset();
                proto::sendFrame(json::Object{{"type", "uiClosed"}});
            });
            ok("ui-closing");
        } else {
            fail("unknown message type " + type);
        }
    } catch (const HostError& e) {
        fail(e.message);
    } catch (const std::exception& e) {
        fail(e.what());
    }
}

[[noreturn]] void serve() {
    proto::Frame frame;
    while (proto::readFrame(frame)) handle(frame.json, frame.binary);
    std::_Exit(0);
}

// MARK: offline CLI

std::string argValue(int argc, char** argv, const std::string& name) {
    for (int i = 0; i + 1 < argc; i++) if (name == argv[i]) return argv[i + 1];
    return "";
}

[[noreturn]] void die(const std::string& m) { std::fprintf(stderr, "%s\n", m.c_str()); std::_Exit(2); }

[[noreturn]] void runOffline(int argc, char** argv) {
    std::string id = argValue(argc, argv, "--id"), inPath = argValue(argc, argv, "--in"), outPath = argValue(argc, argv, "--out");
    if (id.empty() || inPath.empty() || outPath.empty()) die("offline needs --id, --in and --out");
    std::string pathArg = argValue(argc, argv, "--path");
    int channels = argValue(argc, argv, "--channels").empty() ? 2 : std::atoi(argValue(argc, argv, "--channels").c_str());
    double rate = argValue(argc, argv, "--rate").empty() ? 48000 : std::atof(argValue(argc, argv, "--rate").c_str());
    int block = argValue(argc, argv, "--block").empty() ? 512 : std::atoi(argValue(argc, argv, "--block").c_str());
    try {
        FILE* f = std::fopen(inPath.c_str(), "rb");
        if (!f) die("cannot read " + inPath);
        std::vector<uint8_t> raw;
        uint8_t buf[65536];
        size_t got;
        while ((got = std::fread(buf, 1, sizeof buf, f)) > 0) raw.insert(raw.end(), buf, buf + got);
        std::fclose(f);
        auto all = floats(raw);
        size_t frames = all.size() / channels;
        std::vector<std::vector<float>> input(channels);
        for (int c = 0; c < channels; c++) input[c].assign(all.begin() + c * frames, all.begin() + (c + 1) * frames);
        Plugin plugin(id, pathArg);
        plugin.configure(rate, channels, block);
        std::string statePath = argValue(argc, argv, "--state");
        if (!statePath.empty()) {
            FILE* sf = std::fopen(statePath.c_str(), "rb");
            if (sf) { std::string text; char c; while (std::fread(&c, 1, 1, sf) == 1) if (c != '\n' && c != '\r' && c != ' ') text += c; std::fclose(sf); plugin.restore(text); }
        }
        json::Value base;
        std::map<std::string, Lane> lanes;
        std::string autoPath = argValue(argc, argv, "--automation");
        if (!autoPath.empty()) {
            FILE* af = std::fopen(autoPath.c_str(), "rb");
            if (af) {
                std::string text; while ((got = std::fread(buf, 1, sizeof buf, af)) > 0) text.append(reinterpret_cast<char*>(buf), got);
                std::fclose(af);
                json::Value obj = json::parse(text);
                if (const json::Value* b = obj.get("base")) base = *b;
                if (const json::Value* l = obj.get("lanes"); l && l->isObject()) {
                    for (const auto& kv : *l->o) {
                        Lane lane;
                        if (kv.second.isArray()) for (const auto& pt : *kv.second.a) if (pt.isArray() && pt.a->size() >= 2) lane.emplace_back((*pt.a)[0].n, (*pt.a)[1].n);
                        lanes[kv.first] = lane;
                    }
                }
            }
        }
        plugin.applyParameters(base);
        auto result = offlineRender(plugin, input, base, lanes, block);
        FILE* of = std::fopen(outPath.c_str(), "wb");
        if (!of) die("cannot write " + outPath);
        for (int c = 0; c < channels; c++) std::fwrite(result[c].data(), 4, result[c].size(), of);
        std::fclose(of);
        std::string report = json::dump(json::Value(json::Object{{"latencySamples", plugin.latencySamples()}, {"frames", static_cast<int64_t>(frames)}, {"channels", channels}}));
        std::fprintf(stderr, "%s", report.c_str());
        std::fflush(stderr);
        std::_Exit(0);
    } catch (const HostError& e) {
        die(e.message);
    } catch (const std::exception& e) {
        die(e.what());
    }
}

} // namespace

int main(int argc, char** argv) {
    std::string mode = argc > 1 ? argv[1] : "serve";
    if (mode == "offline") runOffline(argc, argv);
    proto::init();
    if (mode == "ui") {
        uiEnabled = true;
        std::thread([] { serve(); }).detach();
        ui::runMainLoop();
    }
    serve();
}
