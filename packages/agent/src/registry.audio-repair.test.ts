import { describe, it, expect } from "vitest";
import { ActionHistory } from "@openreel/core/actions/action-history";
import { HeadlessHost } from "./headless-host";
import { executeTool } from "./executor";
import { getTool } from "./registry";
import { makeProjectWithClip } from "./test-fixtures";
import type { AudioIssueReport, RepairSuggestion } from "@openreel/core/audio/repair/repair-analysis";
import type { AudioRepairBridge, EditingHost, ExportQueueBridge, ExportQueueJobInfo, QueueStemsRequest } from "./host";

const report = (over: Partial<AudioIssueReport> = {}): AudioIssueReport => ({
  durationSec: 5,
  sampleRate: 48000,
  peakDb: -3,
  hum: { present: true, frequency: 50, prominenceDb: 30, harmonics: 3 },
  clipping: { present: false, clippedSamples: 0, runs: 0, peak: 0.7, thresholdDb: -3 },
  clicks: { present: true, count: 6, perMinute: 72 },
  sibilance: { present: false, centerHz: 6500, peakDb: -40, thresholdDb: -30, fraction: 0 },
  ...over,
});

const suggestions: RepairSuggestion[] = [
  { type: "deClick", params: { sensitivity: 0.5, maxWidth: 24 }, reason: "6 clicks detected (72/min)" },
  { type: "deHum", params: { frequency: 50, harmonics: 5, q: 30, depth: 1 }, reason: "50 Hz mains hum" },
];

function setup() {
  const history = new ActionHistory();
  const base = new HeadlessHost(makeProjectWithClip(), { history });
  const bridge: AudioRepairBridge = { analyze: async () => ({ report: report(), suggestions }) };
  const host = Object.assign(base, { audioRepair: bridge }) as EditingHost & HeadlessHost;
  return { host, history, base };
}

const effectsOf = (host: HeadlessHost) => host.getProject().timeline.tracks[0].clips[0].audioEffects ?? [];

describe("audio repair agent tools", () => {
  it("registers the three tools", () => {
    for (const name of ["analyze_audio_issues", "add_audio_repair", "queue_stems_export"]) expect(getTool(name)).toBeDefined();
    expect(getTool("analyze_audio_issues")?.readOnly).toBe(true);
    expect(getTool("add_audio_repair")?.readOnly).toBe(false);
    expect(getTool("queue_stems_export")?.expensive).toBe(true);
  });

  it("get_audio_latency_report lists effect latencies and the mixer's compensated latency (read-only)", async () => {
    const { host, history } = setup();
    expect(getTool("get_audio_latency_report")?.readOnly).toBe(true);
    const before = history.getDisplayHistory().length;
    const result = await executeTool("get_audio_latency_report", {}, host);
    expect(result.ok).toBe(true);
    const data = result.data as { effects: Array<{ type: string; samples: number }>; totalLatencyMs: number; tracks: unknown[] };
    expect(data.effects.find((e) => e.type === "limiter")?.samples).toBe(288);
    expect(data.effects.find((e) => e.type === "deReverb")?.samples).toBeGreaterThan(0);
    expect(data.totalLatencyMs).toBe(0);
    expect(history.getDisplayHistory().length).toBe(before);
  });

  it("analyze_audio_issues reports the findings and suggestions", async () => {
    const { host } = setup();
    const result = await executeTool("analyze_audio_issues", { clipId: "c1" }, host);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/hum 50 Hz/);
    const data = result.data as { suggestions: RepairSuggestion[] };
    expect(data.suggestions.map((s) => s.type)).toEqual(["deClick", "deHum"]);
  });

  it("auto repair adds exactly the suggested effects as ONE undo step", async () => {
    const { host, history } = setup();
    const before = history.getDisplayHistory().length;
    const result = await executeTool("add_audio_repair", { clipId: "c1" }, host);
    expect(result.ok).toBe(true);
    expect(effectsOf(host).map((e) => e.type)).toEqual(["deClick", "deHum"]);
    expect(effectsOf(host)[1].params).toMatchObject({ frequency: 50, harmonics: 5 });
    // Two effects were added, but they form a single undo step.
    expect(history.getDisplayHistory().length).toBe(before + 1);
    expect(history.getUndoStackSize()).toBe(2);
    expect(history.undoGroup()).toHaveLength(2);
    expect(history.getDisplayHistory().length).toBe(before);
  });

  it("explicit fixes work without analysis, sanitise params and update instead of duplicating", async () => {
    const base = new HeadlessHost(makeProjectWithClip());
    const first = await executeTool("add_audio_repair", { clipId: "c1", fixes: ["deHum", "deEss"], params: { deHum: { frequency: 999 }, deEss: { threshold: -28 } } }, base);
    expect(first.ok).toBe(true);
    expect(effectsOf(base).map((e) => e.type)).toEqual(["deHum", "deEss"]);
    expect(effectsOf(base)[0].params.frequency).toBe(70);
    expect(effectsOf(base)[1].params.threshold).toBe(-28);
    const second = await executeTool("add_audio_repair", { clipId: "c1", fixes: ["deHum"], params: { deHum: { frequency: 50 } } }, base);
    expect(second.ok).toBe(true);
    expect(effectsOf(base)).toHaveLength(2);
    expect(effectsOf(base)[0].params.frequency).toBe(50);
  });

  it("rejects unknown effects and clips, and needs a bridge for auto-detect", async () => {
    const base = new HeadlessHost(makeProjectWithClip());
    expect((await executeTool("add_audio_repair", { clipId: "c1", fixes: ["deBurp"] }, base)).ok).toBe(false);
    expect((await executeTool("add_audio_repair", { clipId: "nope", fixes: ["deHum"] }, base)).ok).toBe(false);
    const auto = await executeTool("add_audio_repair", { clipId: "c1" }, base);
    expect(auto.ok).toBe(false);
    expect(auto.error?.code).toBe("UNSUPPORTED_HOST");
  });

  it("add_audio_effect accepts the repair effect types", async () => {
    const base = new HeadlessHost(makeProjectWithClip());
    const result = await executeTool("add_audio_effect", { clipId: "c1", effectType: "deClip", params: { threshold: -1 } }, base);
    expect(result.ok).toBe(true);
    expect(effectsOf(base)[0].type).toBe("deClip");
  });

  it("queue_stems_export forwards buses and bit depth to the export queue", async () => {
    const requests: QueueStemsRequest[] = [];
    const project = makeProjectWithClip();
    (project.timeline as { audioBuses?: unknown }).audioBuses = [
      { id: "bus-1", name: "Dialogue", role: "dialogue", volume: 1 },
      { id: "bus-2", name: "Music", role: "music", volume: 1 },
    ];
    const base = new HeadlessHost(project);
    const bridge: ExportQueueBridge = {
      enqueue: async () => {
        throw new Error("unused");
      },
      enqueueStems: async (request) => {
        requests.push(request);
        const job: ExportQueueJobInfo = {
          id: "job-1",
          outputName: "Test - Stems.zip",
          sequenceName: "Test",
          presetLabel: "Stems: 2 buses · 16-bit WAV",
          status: "running",
          progress: 0,
          elapsedMs: 0,
          usePreviews: false,
          kind: "stems",
          stems: [],
        };
        return job;
      },
      list: () => [],
      cancel: () => ({ found: false }),
    };
    const host = Object.assign(base, { exportQueue: bridge });
    const result = await executeTool("queue_stems_export", { busIds: ["bus-1", "bus-2"], bitDepth: 16 }, host);
    expect(result.ok).toBe(true);
    expect(requests).toEqual([{ busIds: ["bus-1", "bus-2"], bitDepth: 16, filename: undefined, start: true }]);
    expect((result.data as { jobId: string }).jobId).toBe("job-1");
    const bad = await executeTool("queue_stems_export", { busIds: ["ghost"] }, host);
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("BUS_NOT_FOUND");
    const plain = await executeTool("queue_stems_export", {}, new HeadlessHost(makeProjectWithClip()));
    expect(plain.error?.code).toBe("UNSUPPORTED_HOST");
  });
});
