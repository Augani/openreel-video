/**
 * CPU plugin source: contract, static lint and the sandbox bootstrap that runs
 * inside the Worker (see cpu-sandbox.ts for the host side).
 *
 * Contract: the plugin file defines a function
 *
 *   function process(frame, params, host) { ... }
 *
 * `frame` is { width, height, data } where data is a Uint8ClampedArray of
 * straight RGBA. The function either edits `frame.data` in place or returns a
 * Uint8ClampedArray of the same length. `params` are the resolved manifest
 * parameters (colours as {r,g,b} in 0..1, angles in degrees, points as {x,y},
 * choices as their string value). `host` is { time, frame }.
 *
 * Sandbox (defence in depth, see docs/plugin-sdk.md for the exact guarantees):
 *  - runs in a dedicated Worker: no DOM, no window, no localStorage;
 *  - network, storage, nested worker and dynamic import entry points are
 *    deleted from the global scope before the plugin source is evaluated, and
 *    the Function / AsyncFunction / GeneratorFunction constructors are disabled;
 *  - the source is linted for those names so a violation is reported at install;
 *  - the host terminates the Worker when a frame exceeds its timeout.
 */

export const MAX_CPU_SOURCE_BYTES = 256 * 1024;

const FORBIDDEN_TOKENS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /\bimport\b/, name: "import" },
  { re: /\bimportScripts\b/, name: "importScripts" },
  { re: /\beval\b/, name: "eval" },
  { re: /\bFunction\b/, name: "Function" },
  { re: /\.\s*constructor\b/, name: ".constructor" },
  { re: /__proto__/, name: "__proto__" },
  { re: /\bfetch\b/, name: "fetch" },
  { re: /\bXMLHttpRequest\b/, name: "XMLHttpRequest" },
  { re: /\bWebSocket\b/, name: "WebSocket" },
  { re: /\bEventSource\b/, name: "EventSource" },
  { re: /\bWebTransport\b/, name: "WebTransport" },
  { re: /\b(?:Shared)?Worker\b/, name: "Worker" },
  { re: /\bpostMessage\b/, name: "postMessage" },
  { re: /\bglobalThis\b/, name: "globalThis" },
  { re: /\bself\b/, name: "self" },
  { re: /\bwindow\b/, name: "window" },
  { re: /\bindexedDB\b/, name: "indexedDB" },
  { re: /\bBroadcastChannel\b/, name: "BroadcastChannel" },
  { re: /\bprocess\s*\.\s*(?:binding|mainModule|env)\b/, name: "process internals" },
  { re: /\brequire\s*\(/, name: "require" },
];

/** Static lint of CPU plugin source. Returns human readable problems (empty when fine). */
export function lintCpuSource(source: string): string[] {
  const problems: string[] = [];
  if (!source.trim()) return ["cpu source is empty"];
  if (source.length > MAX_CPU_SOURCE_BYTES) problems.push(`cpu source exceeds ${MAX_CPU_SOURCE_BYTES} bytes`);
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const { re, name } of FORBIDDEN_TOKENS) {
    if (re.test(stripped)) problems.push(`cpu source may not use "${name}" (sandboxed plugins have no I/O or dynamic code)`);
  }
  if (!/\bfunction\s+process\s*\(|\bconst\s+process\s*=|\bvar\s+process\s*=|\blet\s+process\s*=/.test(stripped)) {
    problems.push("cpu source must define function process(frame, params, host)");
  }
  return problems;
}

/**
 * Worker bootstrap. Plain JavaScript text (not a TS function) so it can be
 * handed to `new Worker(blobUrl)` and to node `worker_threads` alike.
 *
 * Messages in:  { type: "init", source }            -> out { type: "ready" } | { type: "error", message }
 *               { type: "run", id, width, height, buffer, params, host }
 *                                                   -> out { type: "done", id, buffer } | { type: "error", id, message }
 */
export const CPU_SANDBOX_BOOTSTRAP = `
"use strict";
(function () {
  var scope = typeof self !== "undefined" && typeof self.postMessage === "function" ? self : null;
  var wt = null;
  if (!scope) { wt = require("node:worker_threads"); }
  var send = function (msg, transfer) {
    if (scope) scope.postMessage(msg, transfer || []);
    else wt.parentPort.postMessage(msg, transfer || []);
  };
  var g = typeof globalThis !== "undefined" ? globalThis : scope;
  var RealFunction = Function;
  var compile = function (src) { return new RealFunction("'use strict';\\n" + src + "\\n;return typeof process === 'function' ? process : undefined;"); };

  var DENY = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "Worker", "SharedWorker",
    "importScripts", "indexedDB", "caches", "BroadcastChannel", "MessageChannel", "RTCPeerConnection",
    "localStorage", "sessionStorage", "navigator", "location", "XMLHttpRequestUpload", "Request", "Response",
    "Headers", "FormData", "WebAssembly", "SharedArrayBuffer", "Atomics", "eval", "require", "process", "Buffer",
    "setImmediate", "queueMicrotask", "performance", "crypto", "fs", "module", "exports"];
  var lockDown = function () {
    for (var i = 0; i < DENY.length; i++) {
      // Delete first: on Node 22 redefining the lazy Request/Response/Headers/FormData/WebSocket accessors
      // in place loads undici, whose llhttp WebAssembly instantiation then runs after WebAssembly is denied.
      try { delete g[DENY[i]]; } catch (e0) {}
      try { Object.defineProperty(g, DENY[i], { value: undefined, writable: false, configurable: false }); } catch (e) {
        try { delete g[DENY[i]]; } catch (e2) {}
      }
    }
    var protos = [Function.prototype, Object.getPrototypeOf(async function () {}), Object.getPrototypeOf(function* () {}),
      Object.getPrototypeOf(async function* () {})];
    for (var j = 0; j < protos.length; j++) {
      try { Object.defineProperty(protos[j], "constructor", { value: undefined, writable: false, configurable: false }); } catch (e) {}
    }
  };

  var processFn = null;
  var handle = function (msg) {
    if (msg.type === "init") {
      try {
        var factory = compile(msg.source);
        lockDown();
        processFn = factory();
        if (typeof processFn !== "function") throw new Error("cpu source did not define function process()");
        send({ type: "ready" });
      } catch (e) {
        send({ type: "error", message: String(e && e.message ? e.message : e) });
      }
      return;
    }
    if (msg.type === "run") {
      try {
        if (!processFn) throw new Error("plugin is not initialised");
        var data = new Uint8ClampedArray(msg.buffer);
        var frame = { width: msg.width, height: msg.height, data: data };
        var result = processFn(frame, msg.params, msg.host);
        var out = data;
        if (result !== undefined && result !== null) {
          if (!(result instanceof Uint8ClampedArray) || result.length !== data.length) {
            throw new Error("process() must return a Uint8ClampedArray of width*height*4 bytes (or nothing)");
          }
          out = result;
        }
        var buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
        send({ type: "done", id: msg.id, buffer: buf }, [buf]);
      } catch (e) {
        send({ type: "error", id: msg.id, message: String(e && e.message ? e.message : e) });
      }
    }
  };

  if (scope) scope.onmessage = function (ev) { handle(ev.data); };
  else wt.parentPort.on("message", handle);
})();
`;
