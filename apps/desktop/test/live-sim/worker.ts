/**
 * The "audio thread" of the live insert test rig: a worker_thread that runs the real LiveInsertDsp against a wall clock, one
 * 128 frame render quantum every 2.67 ms (48 kHz), exactly as the AudioWorklet does, and exchanges blocks with the main thread
 * (where the real LiveChain and the real helper processes live) over a MessagePort. It polls its port between quanta with
 * receiveMessageOnPort, the way a worklet's port is serviced between render quanta, and never blocks on anything else.
 *
 * Bundled to CommonJS by live-sim.ts at test time (esbuild); never shipped.
 */
import { MessagePort, parentPort, receiveMessageOnPort, workerData } from "node:worker_threads";
import { LiveInsertDsp } from "../../../../packages/core/src/audio/native-plugin/live/live-insert-dsp";

interface InsertData {
  port: MessagePort;
  blockFrames: number;
  prefillBlocks: number;
  pluginLatencyFrames: number;
  /** Stereo input; looped if shorter than the run. */
  input: Float32Array[];
  record: boolean;
}

interface Data {
  inserts: InsertData[];
  seconds: number;
  sampleRate: number;
  quantum: number;
}

interface Running {
  data: InsertData;
  dsp: LiveInsertDsp;
  recorded: Float32Array[] | null;
  rms: number[];
  hostFailed: string | null;
  inBuf: Float32Array[];
  outBuf: Float32Array[];
}

const data = workerData as Data;
const { quantum, sampleRate } = data;
const total = Math.ceil((data.seconds * sampleRate) / quantum) * quantum;
const quantumNs = BigInt(Math.round((quantum / sampleRate) * 1e9));

// Every insert runs on this one thread, like every AudioWorkletNode of a page runs on its one rendering thread.
const running: Running[] = data.inserts.map((insert) => {
  const dsp = new LiveInsertDsp({
    channels: 2,
    blockFrames: insert.blockFrames,
    prefillBlocks: insert.prefillBlocks,
    pluginLatencyFrames: insert.pluginLatencyFrames,
    onBlock: (epoch, seq, block) => insert.port.postMessage({ t: "in", epoch, seq, data: block }, [block.buffer]),
  });
  dsp.setStreaming(false);
  dsp.setStreaming(true);
  insert.port.postMessage({ t: "epoch", epoch: dsp.epoch, seconds: 0 });
  return { data: insert, dsp, recorded: insert.record ? [new Float32Array(total), new Float32Array(total)] : null, rms: [], hostFailed: null, inBuf: [new Float32Array(quantum), new Float32Array(quantum)], outBuf: [new Float32Array(quantum), new Float32Array(quantum)] };
});
const lateNs: number[] = [];
const sleeper = new Int32Array(new SharedArrayBuffer(4));

const start = process.hrtime.bigint() + 20_000_000n;
for (let n = 0; n < total; n += quantum) {
  const due = start + (BigInt(n / quantum) * quantumNs);
  for (;;) {
    const remaining = Number(due - process.hrtime.bigint());
    if (remaining <= 0) break;
    if (remaining > 2_500_000) Atomics.wait(sleeper, 0, 0, (remaining - 2_000_000) / 1e6);
  }
  lateNs.push(Number(process.hrtime.bigint() - due));
  for (const r of running) {
    for (let m = receiveMessageOnPort(r.data.port); m; m = receiveMessageOnPort(r.data.port)) {
      const msg = m.message as { t?: string; epoch?: number; seq?: number; data?: Float32Array; state?: string; reason?: string };
      if (msg.t === "out" && msg.data) r.dsp.pushWet(msg.epoch ?? 0, msg.seq ?? 0, msg.data);
      else if (msg.t === "status" && msg.state === "crashed") {
        r.hostFailed = msg.reason ?? "crashed";
        r.dsp.setBypassed(true);
      }
    }
    const input = r.data.input;
    const inLen = input[0].length;
    for (let i = 0; i < quantum; i += 1) {
      const k = (n + i) % inLen;
      r.inBuf[0][i] = input[0][k];
      r.inBuf[1][i] = input[1][k];
    }
    r.dsp.process(r.inBuf, r.outBuf, quantum);
    let sum = 0;
    for (let i = 0; i < quantum; i += 1) sum += r.outBuf[0][i] * r.outBuf[0][i] + r.outBuf[1][i] * r.outBuf[1][i];
    r.rms.push(Math.sqrt(sum / (2 * quantum)));
    if (r.recorded) {
      r.recorded[0].set(r.outBuf[0], n);
      r.recorded[1].set(r.outBuf[1], n);
    }
  }
}
const done = { t: "done", lateNs, startNs: start.toString(), inserts: running.map((r) => ({ stats: r.dsp.stats(), latencyFrames: r.dsp.latencyFrames, rms: r.rms, recorded: r.recorded, hostFailed: r.hostFailed })) };
parentPort!.postMessage(done);
