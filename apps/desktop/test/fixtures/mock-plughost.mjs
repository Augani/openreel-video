// A stand-in for openreel-plughost that speaks the same protocol with fake plugins, so scanner, client and render driver
// are tested on every platform. Plugin behaviours are picked by id:
//   au:aufx:gain:mock  gain plugin, parameter "0" is the gain, no latency, state = its parameters
//   au:aufx:lkah:mock  same plus 300 samples of latency (output is the input delayed by 300 frames)
//   au:aufx:cras:mock  segfaults when probed or opened
//   au:aufx:hang:mock  never answers a probe or open
//   au:aufx:junk:mock  writes garbage on the pipe when probed
//   au:aufx:nan0:mock  returns NaN samples
//   au:aufx:mono:mock  refuses a single channel ("does not accept 1 channel(s)"), otherwise a gain plugin
//   au:aufx:cr3b:mock  crashes on the third audio block
//   au:aufx:bad_:mock  refuses to validate with a plain error
//
// VST3 (what openreel-vst3host does): ids "vst3:<hex>" need the bundle `path` in probe/open; the plugin is picked by the bundle name
// (MockGain.vst3, MockLatency.vst3, MockCrash.vst3, MockHang.vst3, MockLateCrash.vst3, MockStereo.vst3) and probe reports the real class id.
import path from "node:path";
const MAGIC = 0x4850524f;
const vst3Bundle = (json) => {
  if (typeof json.id !== "string" || !json.id.startsWith("vst3:")) return null;
  const name = path.basename(String(json.path ?? "")).replace(/\.vst3$/i, "");
  const known = { MockGain: 0, MockLatency: 128, MockCrash: 0, MockHang: 0, MockLateCrash: 0, MockStereo: 0 };
  if (!(name in known)) return { name, latency: 0, unknown: true, classId: "" };
  return { name, latency: known[name], classId: Buffer.from(name).toString("hex").toUpperCase().padEnd(32, "0").slice(0, 32) };
};
const plugins = {
  "au:aufx:gain:mock": { name: "Mock Gain", latency: 0 },
  "au:aufx:lkah:mock": { name: "Mock Lookahead", latency: 300 },
  "au:aufx:cras:mock": { name: "Mock Crasher", latency: 0 },
  "au:aufx:hang:mock": { name: "Mock Hanger", latency: 0 },
  "au:aufx:junk:mock": { name: "Mock Junk", latency: 0 },
  "au:aufx:nan0:mock": { name: "Mock NaN", latency: 0 },
  "au:aufx:mono:mock": { name: "Mock Stereo Only", latency: 0 },
  "au:aufx:cr3b:mock": { name: "Mock Late Crasher", latency: 0 },
  "au:aufx:bad_:mock": { name: "Mock Refuser", latency: 0 },
};
let buffer = Buffer.alloc(0);
const out = (json, bin = Buffer.alloc(0)) => {
  const body = Buffer.from(JSON.stringify(json));
  const header = Buffer.alloc(12);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(body.length, 4);
  header.writeUInt32LE(bin.length, 8);
  process.stdout.write(Buffer.concat([header, body, bin]));
};
let session = null;
let blocks = 0;
const params = (s) => [{ key: "0", name: "Gain", min: 0, max: 4, value: s?.gain ?? 1, unitName: "" }];
const crash = () => {
  if (process.platform === "win32") process.exit(0xc0000005);
  process.kill(process.pid, "SIGSEGV");
};

function handle(json, bin) {
  const reply = (type, fields = {}, payload) => out({ type, reqId: json.reqId, ...fields }, payload);
  const fail = (message) => reply("error", { message });
  switch (json.type) {
    case "hello":
      return reply("ready", { protocol: 1, helper: "mock-plughost", platform: "mock", formats: ["au"] });
    case "list":
      return reply("components", { components: Object.entries(plugins).map(([id, p]) => ({ id, format: "au", name: p.name, vendor: "Mock", version: "1.0", category: "Effect" })) });
    case "probe": {
      if (json.id.startsWith("vst3:")) {
        const b = vst3Bundle(json);
        if (!json.path) return fail("the plugin bundle could not be loaded: no path");
        if (b.unknown) return fail("the plugin bundle could not be loaded: unknown bundle");
        if (b.name === "MockCrash") return crash();
        if (b.name === "MockHang") return undefined;
        return reply("probed", { ok: true, latencySamples: b.latency, tailSeconds: 0, parameters: params(), classId: b.classId, name: b.name, vendor: "MockVendor", version: "1.2.3", category: "Fx|Mock" });
      }
      if (json.id === "au:aufx:cras:mock") return crash();
      if (json.id === "au:aufx:hang:mock") return undefined;
      if (json.id === "au:aufx:junk:mock") return process.stdout.write(Buffer.from("this is not a frame at all......"));
      if (json.id === "au:aufx:bad_:mock") return fail("the plugin does not accept 2 channel(s) at 48000 Hz");
      const p = plugins[json.id];
      if (!p) return fail("unknown plugin");
      return reply("probed", { ok: true, latencySamples: p.latency, tailSeconds: 0.5, parameters: params() });
    }
    case "open": {
      const b = json.id.startsWith("vst3:") ? vst3Bundle(json) : null;
      if (b) {
        if (!json.path) return fail("open needs the path of the .vst3 bundle");
        if (b.unknown) return fail("the plugin bundle could not be loaded: unknown bundle");
        if (b.name === "MockCrash") return crash();
        if (b.name === "MockHang") return undefined;
        if (b.name === "MockStereo" && json.channels === 1) return fail("the plugin does not accept 1 channel(s)");
        let gain = 1;
        if (json.state) gain = JSON.parse(Buffer.from(json.state, "base64").toString()).gain ?? 1;
        if (json.params && json.params["0"] !== undefined) gain = json.params["0"];
        session = { id: `vst3:${b.name}`, late: b.name === "MockLateCrash", channels: json.channels, gain, delay: b.latency, history: Array.from({ length: json.channels }, () => new Float32Array(b.latency)), path: json.path };
        blocks = 0;
        return reply("opened", { latencySamples: b.latency, tailSeconds: 0, parameters: params(session) });
      }
      const p = plugins[json.id];
      if (!p) return fail("unknown plugin");
      if (json.id === "au:aufx:cras:mock") return crash();
      if (json.id === "au:aufx:hang:mock") return undefined;
      if (json.id === "au:aufx:mono:mock" && json.channels === 1) return fail("the plugin does not accept 1 channel(s) at 48000 Hz");
      let gain = 1;
      if (json.state) gain = JSON.parse(Buffer.from(json.state, "base64").toString()).gain ?? 1;
      if (json.params && json.params["0"] !== undefined) gain = json.params["0"];
      session = { id: json.id, channels: json.channels, gain, delay: p.latency, history: Array.from({ length: json.channels }, () => new Float32Array(p.latency)) };
      blocks = 0;
      return reply("opened", { latencySamples: p.latency, tailSeconds: 0.5, parameters: params(session) });
    }
    case "block": {
      if (!session) return fail("no plugin is open");
      blocks += 1;
      if ((session.id === "au:aufx:cr3b:mock" || session.late) && blocks === 3) return crash();
      if (json.params && json.params["0"] !== undefined) session.gain = json.params["0"];
      const frames = json.frames;
      const input = new Float32Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length));
      const result = new Float32Array(input.length);
      for (let c = 0; c < session.channels; c += 1) {
        const hist = session.history[c];
        for (let i = 0; i < frames; i += 1) {
          const x = input[c * frames + i];
          let y = x;
          if (session.delay > 0) {
            // ring of `delay` frames: output is the input delayed by `delay`
            y = hist[0];
            hist.copyWithin(0, 1);
            hist[session.delay - 1] = x;
          }
          result[c * frames + i] = session.id === "au:aufx:nan0:mock" ? NaN : y * session.gain;
        }
      }
      return reply("blockResult", { frames }, Buffer.from(result.buffer));
    }
    case "reset":
      if (!session) return fail("no plugin is open");
      for (const hist of session.history) hist.fill(0);
      return reply("reset");
    case "getState":
      return reply("state", { state: Buffer.from(JSON.stringify({ gain: session?.gain ?? 1 })).toString("base64"), parameters: params(session) });
    case "setState":
      if (!session) return fail("no plugin is open");
      session.gain = JSON.parse(Buffer.from(json.state, "base64").toString()).gain ?? 1;
      return reply("stateSet", { parameters: params(session) });
    case "close":
      session = null;
      return reply("closed");
    default:
      return fail(`unknown message type ${json.type}`);
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 12) {
    const jl = buffer.readUInt32LE(4);
    const bl = buffer.readUInt32LE(8);
    if (buffer.length < 12 + jl + bl) break;
    const json = JSON.parse(buffer.subarray(12, 12 + jl).toString());
    const bin = buffer.subarray(12 + jl, 12 + jl + bl);
    buffer = buffer.subarray(12 + jl + bl);
    handle(json, bin);
  }
});
process.stdin.on("end", () => process.exit(0));
