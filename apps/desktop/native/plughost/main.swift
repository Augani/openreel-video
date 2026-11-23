// openreel-plughost: the out-of-process audio plugin host (macOS Audio Units).
//
// The editor never loads third-party plugin code. This helper does, in its own process, so a plugin that crashes,
// hangs or corrupts memory takes the helper down and nothing else. It speaks the framed protocol documented in
// apps/desktop/src/shared/plughost-protocol.ts over stdin/stdout:
//
//   frame := magic u32 LE ("ORPH") | jsonLength u32 LE | binaryLength u32 LE | json | binary
//
// Modes:
//   serve    framed protocol: list / probe / open / block / getState / setState / close
//   ui       like serve, plus a native window for the plugin's own editor (ui-open)
//   offline  command line render of a raw planar float32 file, the reference the editor's own pipe render is checked against
//
// Only Audio Units are hosted here (AUv2 and AUv3 through AUAudioUnit). VST3 bundles are discovered by the editor's
// scanner and reported as "no backend": see docs/known-limitations.md.

import Foundation
import AVFoundation
import AudioToolbox
import CoreAudioKit
import AppKit

setvbuf(stdout, nil, _IOLBF, 0)

// MARK: - Protocol I/O

let FRAME_MAGIC: UInt32 = 0x4850_524F // bytes "ORPH" little endian
let MAX_JSON = 4 * 1024 * 1024
let MAX_BIN = 256 * 1024 * 1024

// Anything a plugin prints to stdout would corrupt the frame stream, so frames go to a private copy of fd 1
// and fd 1 itself is pointed at stderr.
let protocolOut: Int32 = dup(1)
dup2(2, 1)

func readExact(_ fd: Int32, _ count: Int) -> Data? {
    if count == 0 { return Data() }
    var data = Data(count: count)
    var got = 0
    let ok: Bool = data.withUnsafeMutableBytes { raw -> Bool in
        guard let base = raw.baseAddress else { return false }
        while got < count {
            let n = read(fd, base + got, count - got)
            if n <= 0 { if n < 0 && errno == EINTR { continue }; return false }
            got += n
        }
        return true
    }
    return ok ? data : nil
}

func writeAll(_ fd: Int32, _ data: Data) -> Bool {
    var sent = 0
    return data.withUnsafeBytes { raw -> Bool in
        guard let base = raw.baseAddress else { return true }
        while sent < data.count {
            let n = write(fd, base + sent, data.count - sent)
            if n <= 0 { if n < 0 && errno == EINTR { continue }; return false }
            sent += n
        }
        return true
    }
}

let writeLock = NSLock()

func sendFrame(_ json: [String: Any], binary: Data = Data()) {
    guard let body = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    var header = Data(count: 12)
    header.withUnsafeMutableBytes { raw in
        raw.storeBytes(of: FRAME_MAGIC.littleEndian, toByteOffset: 0, as: UInt32.self)
        raw.storeBytes(of: UInt32(body.count).littleEndian, toByteOffset: 4, as: UInt32.self)
        raw.storeBytes(of: UInt32(binary.count).littleEndian, toByteOffset: 8, as: UInt32.self)
    }
    writeLock.lock(); defer { writeLock.unlock() }
    if !writeAll(protocolOut, header) || !writeAll(protocolOut, body) || !writeAll(protocolOut, binary) { exit(3) }
}

func readFrame() -> (json: [String: Any], binary: Data)? {
    guard let header = readExact(0, 12) else { return nil }
    let (magic, jl, bl) = header.withUnsafeBytes { raw -> (UInt32, Int, Int) in
        (UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 0, as: UInt32.self)),
         Int(UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 4, as: UInt32.self))),
         Int(UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: 8, as: UInt32.self))))
    }
    if magic != FRAME_MAGIC || jl > MAX_JSON || bl > MAX_BIN { return nil }
    guard let body = readExact(0, jl), let bin = readExact(0, bl) else { return nil }
    guard let obj = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] else { return nil }
    return (obj, bin)
}

// MARK: - Component ids ("au:aufx:dely:appl")

func fourCC(_ code: UInt32) -> String {
    let bytes = [UInt8((code >> 24) & 255), UInt8((code >> 16) & 255), UInt8((code >> 8) & 255), UInt8(code & 255)]
    // Escape anything that is not printable ASCII or the id would not survive a round trip.
    return String(bytes.map { b -> Character in (b >= 0x20 && b < 0x7F && b != 0x3A) ? Character(UnicodeScalar(b)) : "?" })
}

func codeOf(_ text: String) -> UInt32? {
    let bytes = Array(text.utf8)
    if bytes.count != 4 { return nil }
    return (UInt32(bytes[0]) << 24) | (UInt32(bytes[1]) << 16) | (UInt32(bytes[2]) << 8) | UInt32(bytes[3])
}

func descriptionOf(id: String) -> AudioComponentDescription? {
    let parts = id.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard parts.count == 4, parts[0] == "au", let t = codeOf(parts[1]), let s = codeOf(parts[2]), let m = codeOf(parts[3]) else { return nil }
    return AudioComponentDescription(componentType: t, componentSubType: s, componentManufacturer: m, componentFlags: 0, componentFlagsMask: 0)
}

func idOf(_ d: AudioComponentDescription) -> String {
    "au:\(fourCC(d.componentType)):\(fourCC(d.componentSubType)):\(fourCC(d.componentManufacturer))"
}

func listComponents() -> [[String: Any]] {
    var out: [[String: Any]] = []
    for type in [kAudioUnitType_Effect, kAudioUnitType_MusicEffect] {
        let want = AudioComponentDescription(componentType: type, componentSubType: 0, componentManufacturer: 0, componentFlags: 0, componentFlagsMask: 0)
        for comp in AVAudioUnitComponentManager.shared().components(matching: want) {
            let d = comp.audioComponentDescription
            out.append([
                "id": idOf(d), "format": "au", "name": comp.name, "vendor": comp.manufacturerName,
                "version": comp.versionString, "category": comp.typeName, "hasCustomView": comp.hasCustomView,
                "sandboxSafe": comp.isSandboxSafe,
            ])
        }
    }
    out.sort { ($0["id"] as! String) < ($1["id"] as! String) }
    return out
}

// MARK: - Plugin instance

struct HostError: Error { let message: String }

final class Plugin {
    let avUnit: AVAudioUnit
    let au: AUAudioUnit
    let id: String
    var sampleRate: Double = 48000
    var channels: Int = 2
    var maxBlock: Int = 512
    var allocated = false
    var parameters: [String: AUParameter] = [:]
    var sampleTime: Float64 = 0
    var inScratch: [UnsafeMutablePointer<Float>] = []
    var outScratch: [UnsafeMutablePointer<Float>] = []
    var pullFrames = 0

    init(id: String) throws {
        guard let desc = descriptionOf(id: id) else { throw HostError(message: "invalid plugin id \(id)") }
        let sema = DispatchSemaphore(value: 0)
        var made: AVAudioUnit?
        var failure: String?
        AVAudioUnit.instantiate(with: desc, options: [.loadInProcess]) { unit, error in
            made = unit
            if unit == nil { failure = error?.localizedDescription ?? "the plugin could not be created" }
            sema.signal()
        }
        if sema.wait(timeout: .now() + 20) == .timedOut { throw HostError(message: "the plugin took too long to load") }
        guard let unit = made else { throw HostError(message: failure ?? "the plugin could not be created") }
        self.avUnit = unit
        self.au = unit.auAudioUnit
        self.id = id
    }

    func configure(sampleRate: Double, channels: Int, maxBlock: Int, realtime: Bool = false) throws {
        if allocated { au.deallocateRenderResources(); allocated = false }
        self.sampleRate = sampleRate; self.channels = channels; self.maxBlock = maxBlock
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: AVAudioChannelCount(channels), interleaved: false) else {
            throw HostError(message: "unsupported audio format")
        }
        do {
            // The v2 bridge leaves the input bus disabled until a host enables it (rendering then fails with NoConnection).
            if au.inputBusses.count > 0 { au.inputBusses[0].isEnabled = true; try au.inputBusses[0].setFormat(format) }
            if au.outputBusses.count > 0 { try au.outputBusses[0].setFormat(format) }
        } catch {
            throw HostError(message: "the plugin does not accept \(channels) channel(s) at \(Int(sampleRate)) Hz: \(error.localizedDescription)")
        }
        // Live inserts ask for realtime mode (what a DAW does while playing); renders and the offline CLI stay offline.
        au.isRenderingOffline = !realtime
        au.maximumFramesToRender = AUAudioFrameCount(maxBlock)
        do { try au.allocateRenderResources() } catch { throw HostError(message: "allocateRenderResources failed: \(error.localizedDescription)") }
        allocated = true
        sampleTime = 0
        freeScratch()
        for _ in 0..<channels {
            let a = UnsafeMutablePointer<Float>.allocate(capacity: maxBlock); a.initialize(repeating: 0, count: maxBlock); inScratch.append(a)
            let b = UnsafeMutablePointer<Float>.allocate(capacity: maxBlock); b.initialize(repeating: 0, count: maxBlock); outScratch.append(b)
        }
        parameters = [:]
        for p in au.parameterTree?.allParameters ?? [] { parameters[String(p.address)] = p }
    }

    var latencySamples: Int { Int((au.latency * sampleRate).rounded()) }
    var tailSeconds: Double { let t = au.tailTime; return t.isFinite ? max(0, t) : 0 }

    func describeParameters() -> [[String: Any]] {
        var out: [[String: Any]] = []
        for p in au.parameterTree?.allParameters ?? [] {
            out.append([
                "key": String(p.address), "name": p.displayName, "identifier": p.identifier,
                "min": Double(p.minValue), "max": Double(p.maxValue), "value": Double(p.value),
                "unit": Int(p.unit.rawValue), "unitName": p.unitName ?? "",
                "indexed": p.unit == .indexed || p.unit == .boolean,
            ])
        }
        return out
    }

    func applyParameters(_ values: [String: Any]) {
        for (key, raw) in values {
            guard let p = parameters[key], let v = (raw as? NSNumber)?.doubleValue else { continue }
            let clamped = min(Double(p.maxValue), max(Double(p.minValue), v))
            p.value = AUValue(clamped)
        }
    }

    func fullStateBase64() -> String? {
        guard let state = au.fullState else { return nil }
        guard let data = try? PropertyListSerialization.data(fromPropertyList: state, format: .binary, options: 0) else { return nil }
        return data.base64EncodedString()
    }

    func restore(stateBase64: String) throws {
        guard let data = Data(base64Encoded: stateBase64),
              let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any]
        else { throw HostError(message: "the saved plugin state is not readable") }
        au.fullState = plist
    }

    /// Processes `frames` of planar input (channels * frames float32, channel after channel) and returns the same shape.
    func process(frames: Int, planarInput: UnsafePointer<Float>) throws -> [Float] {
        if frames > maxBlock { throw HostError(message: "block of \(frames) frames exceeds the maximum \(maxBlock)") }
        for c in 0..<channels {
            for i in 0..<frames { inScratch[c][i] = planarInput[c * frames + i] }
        }
        pullFrames = frames
        let outList = AudioBufferList.allocate(maximumBuffers: channels)
        defer { free(outList.unsafeMutablePointer) }
        for c in 0..<channels {
            outList[c] = AudioBuffer(mNumberChannels: 1, mDataByteSize: UInt32(frames * 4), mData: UnsafeMutableRawPointer(outScratch[c]))
        }
        var flags = AudioUnitRenderActionFlags()
        var stamp = AudioTimeStamp()
        stamp.mSampleTime = sampleTime
        stamp.mFlags = .sampleTimeValid
        var result = [Float](repeating: 0, count: channels * frames)
        let ins = inScratch
        let chCount = channels
        let status = au.renderBlock(&flags, &stamp, AUAudioFrameCount(frames), 0, outList.unsafeMutablePointer, { (_, _, count, _, abl) -> AUAudioUnitStatus in
            let list = UnsafeMutableAudioBufferListPointer(abl)
            for c in 0..<min(chCount, list.count) {
                if let dst = list[c].mData?.assumingMemoryBound(to: Float.self) {
                    for i in 0..<Int(count) { dst[i] = i < frames ? ins[c][i] : 0 }
                    list[c].mDataByteSize = UInt32(Int(count) * 4)
                }
            }
            return noErr
        })
        for c in 0..<channels {
            if let src = outList[c].mData?.assumingMemoryBound(to: Float.self) {
                for i in 0..<frames { result[c * frames + i] = src[i] }
            }
        }
        if status != noErr { throw HostError(message: "the plugin failed to render (status \(status))") }
        sampleTime += Float64(frames)
        return result
    }

    func freeScratch() {
        for p in inScratch { p.deallocate() }
        for p in outScratch { p.deallocate() }
        inScratch = []; outScratch = []
    }

    func close() {
        if allocated { au.deallocateRenderResources(); allocated = false }
        freeScratch()
    }
}

func floats(_ data: Data) -> [Float] {
    var out = [Float](repeating: 0, count: data.count / 4)
    _ = out.withUnsafeMutableBytes { data.copyBytes(to: $0) }
    return out
}

func bytes(_ values: [Float]) -> Data { values.withUnsafeBufferPointer { Data(buffer: $0) } }

// MARK: - Automation (identical math to the editor's TypeScript evaluateLane)

func laneValue(_ lane: [[Double]], at time: Double) -> Double? {
    guard let first = lane.first, let last = lane.last else { return nil }
    if time <= first[0] { return first[1] }
    if time >= last[0] { return last[1] }
    var lo = 0, hi = lane.count - 1
    while hi - lo > 1 { let mid = (lo + hi) >> 1; if lane[mid][0] <= time { lo = mid } else { hi = mid } }
    let a = lane[lo], b = lane[hi]
    let span = b[0] - a[0]
    if span <= 0 { return b[1] }
    return a[1] + (b[1] - a[1]) * ((time - a[0]) / span)
}

// MARK: - Offline render (shared block loop, also the CLI reference)

func offlineRender(plugin: Plugin, input: [[Float]], base: [String: Any], lanes: [String: [[Double]]], block: Int, includeLatencyTrim: Bool = true) throws -> [[Float]] {
    let n = input.first?.count ?? 0
    let latency = plugin.latencySamples
    let total = n + latency
    var output = [[Float]](repeating: [Float](repeating: 0, count: total), count: plugin.channels)
    var start = 0
    while start < total {
        let frames = min(block, total - start)
        var planar = [Float](repeating: 0, count: plugin.channels * frames)
        for c in 0..<plugin.channels {
            for i in 0..<frames where start + i < n { planar[c * frames + i] = input[c][start + i] }
        }
        var values = base
        let t = Double(start) / plugin.sampleRate
        for (key, lane) in lanes { if let v = laneValue(lane, at: t) { values[key] = v } }
        plugin.applyParameters(values)
        let out = try planar.withUnsafeBufferPointer { try plugin.process(frames: frames, planarInput: $0.baseAddress!) }
        for c in 0..<plugin.channels { for i in 0..<frames { output[c][start + i] = out[c * frames + i] } }
        start += frames
    }
    return output.map { Array($0[latency..<(latency + n)]) }
}

// MARK: - Serve

var session: Plugin?

func str(_ j: [String: Any], _ k: String) -> String? { j[k] as? String }
func num(_ j: [String: Any], _ k: String) -> Double? { (j[k] as? NSNumber)?.doubleValue }

func handle(_ j: [String: Any], _ binary: Data) {
    let type = str(j, "type") ?? ""
    let reqId = j["reqId"] ?? NSNull()
    func ok(_ type: String, _ fields: [String: Any] = [:], binary: Data = Data()) {
        var body = fields; body["type"] = type; body["reqId"] = reqId
        sendFrame(body, binary: binary)
    }
    func fail(_ message: String) { ok("error", ["message": message]) }
    do {
        switch type {
        case "hello":
            ok("ready", ["protocol": 1, "helper": "openreel-plughost", "version": "1.0.0", "platform": "darwin", "formats": ["au"]])
        case "list":
            ok("components", ["components": listComponents()])
        case "probe":
            guard let id = str(j, "id") else { return fail("probe needs an id") }
            let plugin = try Plugin(id: id)
            try plugin.configure(sampleRate: 48000, channels: 2, maxBlock: 512)
            // Validate: render noise and look for NaN / Inf / runaway output, the way a host's scan would.
            var seed: UInt32 = 12345
            var worst: Float = 0
            for _ in 0..<8 {
                var noise = [Float](repeating: 0, count: 2 * 512)
                for i in 0..<noise.count { seed = seed &* 1664525 &+ 1013904223; noise[i] = (Float(seed >> 8) / Float(1 << 24) - 0.5) * 0.5 }
                let out = try noise.withUnsafeBufferPointer { try plugin.process(frames: 512, planarInput: $0.baseAddress!) }
                for v in out { if !v.isFinite { throw HostError(message: "the plugin produced NaN or infinite samples") }; worst = max(worst, abs(v)) }
            }
            if worst > 64 { throw HostError(message: "the plugin produced runaway output (\(worst))") }
            ok("probed", ["ok": true, "latencySamples": plugin.latencySamples, "tailSeconds": plugin.tailSeconds,
                          "parameters": plugin.describeParameters(), "peak": Double(worst)])
            plugin.close()
        case "open":
            guard let id = str(j, "id") else { return fail("open needs an id") }
            session?.close()
            let plugin = try Plugin(id: id)
            let realtime = (j["realtime"] as? Bool) ?? false
            // A live insert has a deadline every few milliseconds: ask the scheduler for the interactive class (renders keep the default).
            if realtime { pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0) }
            try plugin.configure(sampleRate: num(j, "sampleRate") ?? 48000, channels: Int(num(j, "channels") ?? 2), maxBlock: Int(num(j, "maxBlock") ?? 512), realtime: realtime)
            if let state = str(j, "state"), !state.isEmpty { try plugin.restore(stateBase64: state) }
            if let values = j["params"] as? [String: Any] { plugin.applyParameters(values) }
            session = plugin
            ok("opened", ["latencySamples": plugin.latencySamples, "tailSeconds": plugin.tailSeconds, "parameters": plugin.describeParameters()])
        case "block":
            guard let plugin = session else { return fail("no plugin is open") }
            let frames = Int(num(j, "frames") ?? 0)
            if let values = j["params"] as? [String: Any] { plugin.applyParameters(values) }
            if binary.count != frames * plugin.channels * 4 { return fail("block payload has \(binary.count) bytes, expected \(frames * plugin.channels * 4)") }
            let input = floats(binary)
            let out = try input.withUnsafeBufferPointer { try plugin.process(frames: frames, planarInput: $0.baseAddress!) }
            ok("blockResult", ["frames": frames], binary: bytes(out))
        case "reset":
            guard let plugin = session else { return fail("no plugin is open") }
            plugin.au.reset()
            ok("reset")
        case "getState":
            guard let plugin = session else { return fail("no plugin is open") }
            ok("state", ["state": plugin.fullStateBase64() ?? NSNull(), "parameters": plugin.describeParameters()])
        case "setState":
            guard let plugin = session, let state = str(j, "state") else { return fail("setState needs an open plugin and a state") }
            try plugin.restore(stateBase64: state)
            ok("stateSet", ["parameters": plugin.describeParameters()])
        case "close":
            session?.close(); session = nil
            ok("closed")
        case "ui-open":
            guard uiEnabled else { return fail("this helper was not started in ui mode") }
            guard let id = str(j, "id") else { return fail("ui-open needs an id") }
            DispatchQueue.main.async {
                do {
                    let plugin = try Plugin(id: id)
                    try plugin.configure(sampleRate: num(j, "sampleRate") ?? 48000, channels: Int(num(j, "channels") ?? 2), maxBlock: 512)
                    if let state = str(j, "state"), !state.isEmpty { try plugin.restore(stateBase64: state) }
                    if let values = j["params"] as? [String: Any] { plugin.applyParameters(values) }
                    UIController.shared.show(plugin: plugin, title: str(j, "title") ?? plugin.id, reqId: reqId)
                } catch {
                    sendFrame(["type": "error", "reqId": reqId, "message": (error as? HostError)?.message ?? "\(error)"])
                }
            }
        case "ui-set":
            // Pushes a parameter value into the open plugin window (the slider in the inspector moved); observers fire like a UI edit.
            guard uiEnabled, let key = str(j, "key"), let value = num(j, "value") else { return fail("ui-set needs ui mode, a key and a value") }
            DispatchQueue.main.async {
                if let p = UIController.shared.plugin?.parameters[key] {
                    p.setValue(AUValue(min(Double(p.maxValue), max(Double(p.minValue), value))), originator: nil)
                }
            }
            ok("ui-set")
        case "ui-close":
            DispatchQueue.main.async { UIController.shared.close() }
            ok("ui-closing")
        default:
            fail("unknown message type \(type)")
        }
    } catch {
        fail((error as? HostError)?.message ?? "\(error)")
    }
}

// MARK: - Plugin window

var uiEnabled = false

final class UIController: NSObject, NSWindowDelegate {
    static let shared = UIController()
    var window: NSWindow?
    var plugin: Plugin?
    var token: AUParameterObserverToken?
    var reqId: Any = NSNull()

    func show(plugin: Plugin, title: String, reqId: Any) {
        close()
        self.plugin = plugin
        self.reqId = reqId
        let finish: (NSView?) -> Void = { [self] view in
            DispatchQueue.main.async { [self] in
                guard let view = view else {
                    sendFrame(["type": "error", "reqId": reqId, "message": "the plugin has no editor window"])
                    return
                }
                let size = view.frame.size.width > 10 ? view.frame.size : NSSize(width: 420, height: 320)
                let win = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
                win.title = title
                win.contentView = view
                win.delegate = self
                win.isReleasedWhenClosed = false
                win.center()
                win.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
                window = win
                if let tree = plugin.au.parameterTree {
                    token = tree.token(byAddingParameterObserver: { address, value in
                        sendFrame(["type": "paramChanged", "key": String(address), "value": Double(value)])
                    })
                }
                sendFrame(["type": "uiOpened", "reqId": reqId, "width": Double(size.width), "height": Double(size.height), "title": title])
            }
        }
        plugin.au.requestViewController { vc in
            if let vc = vc { finish(vc.view) }
            else {
                DispatchQueue.main.async { finish(AUGenericView(audioUnit: plugin.avUnit.audioUnit)) }
            }
        }
    }

    func close() {
        guard let win = window else { return }
        window = nil
        win.delegate = nil
        emitFinalState()
        win.close()
        if let t = token, let tree = plugin?.au.parameterTree { tree.removeParameterObserver(t) }
        token = nil
        plugin?.close(); plugin = nil
        sendFrame(["type": "uiClosed"])
    }

    func emitFinalState() {
        guard let p = plugin else { return }
        sendFrame(["type": "uiState", "state": p.fullStateBase64() ?? NSNull(), "parameters": p.describeParameters()])
    }

    func windowWillClose(_ notification: Notification) {
        window?.delegate = nil
        let win = window
        window = nil
        emitFinalState()
        if let t = token, let tree = plugin?.au.parameterTree { tree.removeParameterObserver(t) }
        token = nil
        plugin?.close(); plugin = nil
        _ = win
        sendFrame(["type": "uiClosed"])
    }
}

func serve() {
    while let (json, bin) = readFrame() {
        // The UI needs the main thread for AppKit; the audio work stays on the reader thread.
        handle(json, bin)
    }
    exit(0)
}

// MARK: - Offline CLI

func argValue(_ name: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func runOffline() -> Never {
    func die(_ message: String) -> Never { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(2) }
    guard let id = argValue("--id"), let inPath = argValue("--in"), let outPath = argValue("--out") else { die("offline needs --id, --in and --out") }
    let channels = Int(argValue("--channels") ?? "2") ?? 2
    let rate = Double(argValue("--rate") ?? "48000") ?? 48000
    let block = Int(argValue("--block") ?? "512") ?? 512
    do {
        guard let raw = FileManager.default.contents(atPath: inPath) else { die("cannot read \(inPath)") }
        let all = floats(raw)
        let frames = all.count / channels
        var input: [[Float]] = []
        for c in 0..<channels { input.append(Array(all[(c * frames)..<((c + 1) * frames)])) }
        let plugin = try Plugin(id: id)
        try plugin.configure(sampleRate: rate, channels: channels, maxBlock: block)
        if let statePath = argValue("--state"), let text = try? String(contentsOfFile: statePath, encoding: .utf8) { try plugin.restore(stateBase64: text.trimmingCharacters(in: .whitespacesAndNewlines)) }
        var base: [String: Any] = [:]
        var lanes: [String: [[Double]]] = [:]
        if let autoPath = argValue("--automation"), let data = FileManager.default.contents(atPath: autoPath),
           let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            base = obj["base"] as? [String: Any] ?? [:]
            for (k, v) in (obj["lanes"] as? [String: Any] ?? [:]) {
                lanes[k] = (v as? [[Any]] ?? []).map { pair in pair.map { ($0 as? NSNumber)?.doubleValue ?? 0 } }
            }
        }
        plugin.applyParameters(base)
        let result = try offlineRender(plugin: plugin, input: input, base: base, lanes: lanes, block: block)
        var flat: [Float] = []
        for c in 0..<channels { flat.append(contentsOf: result[c]) }
        FileManager.default.createFile(atPath: outPath, contents: bytes(flat))
        let report: [String: Any] = ["latencySamples": plugin.latencySamples, "frames": frames, "channels": channels]
        FileHandle.standardError.write((try? JSONSerialization.data(withJSONObject: report)) ?? Data())
        exit(0)
    } catch {
        die((error as? HostError)?.message ?? "\(error)")
    }
}

// MARK: - Entry

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "serve"
switch mode {
case "offline":
    runOffline()
case "ui":
    uiEnabled = true
    NSApplication.shared.setActivationPolicy(.accessory)
    Thread.detachNewThread { serve() }
    NSApplication.shared.run()
default:
    serve()
}
