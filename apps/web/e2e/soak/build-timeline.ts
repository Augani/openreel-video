import type { Page } from "@playwright/test";
import { importInput } from "../helpers";
import { SOAK_CLIPS, SOAK_TIMELINE_MINUTES, type MediaManifestEntry } from "./soak-lib";

/**
 * Builds a feature-length timeline through the real store / action paths (every clip is one
 * `clip/add` action, every effect/transition/title/caption/nest/bus is the same command the UI
 * issues). The numbers below are the defaults of SOAK_CLIPS / SOAK_TIMELINE_MINUTES; the smoke run
 * shrinks both.
 */

export interface BuildReport {
  timelineSeconds: number;
  clips: { video: number; audio: number; total: number };
  tracks: { video: number; audio: number; other: number };
  transitions: number;
  effects: number;
  colored: number;
  titles: number;
  graphics: number;
  captions: number;
  nests: number;
  multicamSources: number;
  buses: number;
  repairRacks: number;
  historyDepth: number;
  importMs: number;
  buildMs: number;
  addClipMsFirst100: number;
  addClipMsLast100: number;
  stageErrors: Array<{ stage: string; message: string }>;
  mediaIds: Record<string, string>;
}

/** Open a blank horizontal project (no fixture import) and return once the program canvas is up. */
export async function openBlankEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("openreel-onboarding-complete", "true");
      localStorage.setItem("openreel-mograph-tour-complete", "true");
    } catch {
      /* storage unavailable */
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Horizontal/ }).click();
  await page.locator('canvas[aria-label^="Program frame"]').waitFor({ timeout: 90_000 });
}

/** Import files through the Media panel input; resolves with name -> mediaId once every one decoded. */
export async function importSources(page: Page, sources: MediaManifestEntry[], timeoutMs = 20 * 60_000): Promise<Record<string, string>> {
  await importInput(page).setInputFiles(sources.map((s) => s.file));
  const names = sources.map((s) => s.file.split("/").pop() as string);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await page.evaluate((expected) => {
      const items = (window as any).__openreelE2E.project.getState().project.mediaLibrary.items as Array<any>;
      const out: Record<string, string> = {};
      for (const n of expected) {
        const m = items.find((i) => i.name === n);
        if (m && m.metadata?.duration > 0) out[n] = m.id;
      }
      return out;
    }, names);
    if (Object.keys(ready).length === names.length) return ready;
    if (Date.now() > deadline) throw new Error(`import timed out: have ${Object.keys(ready).join(", ")}`);
    await page.waitForTimeout(1000);
  }
}

export async function buildFeatureTimeline(
  page: Page,
  mediaIds: Record<string, string>,
  sources: MediaManifestEntry[],
  opts: { clips?: number; minutes?: number } = {},
): Promise<BuildReport> {
  const input = {
    clips: opts.clips ?? SOAK_CLIPS,
    minutes: opts.minutes ?? SOAK_TIMELINE_MINUTES,
    media: sources.map((s) => ({ file: s.file.split("/").pop() as string, id: mediaIds[s.file.split("/").pop() as string], seconds: s.seconds, name: s.name })),
  };
  return page.evaluate(async (cfg) => {
    const E = (window as any).__openreelE2E;
    const st = () => E.project.getState();
    const t0 = performance.now();
    const errors: Array<{ stage: string; message: string }> = [];
    const stage = async (name: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        errors.push({ stage: name, message: (e as Error)?.message ?? String(e) });
      }
    };
    let seed = 20260101;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (a: number, b: number) => a + rnd() * (b - a);

    const T = cfg.minutes * 60;
    const media = cfg.media as Array<{ id: string; seconds: number; name: string }>;

    // --- tracks: 6 video + 8 audio ---------------------------------------------------------------
    const trackIds = { video: [] as string[], audio: [] as string[] };
    await stage("tracks", async () => {
      for (let i = 0; i < 6; i++) {
        await st().addTrack("video", undefined, { name: `V${i + 1}` });
      }
      for (let i = 0; i < 8; i++) {
        await st().addTrack("audio", undefined, { name: `A${i + 1}` });
      }
      const tracks = st().project.timeline.tracks;
      trackIds.video = tracks.filter((t: any) => t.type === "video").map((t: any) => t.id);
      trackIds.audio = tracks.filter((t: any) => t.type === "audio").map((t: any) => t.id);
    });

    // --- media clips (one clip/add action each) --------------------------------------------------
    const addTimes: number[] = [];
    const v1Clips: Array<{ id: string; start: number; duration: number }> = [];
    const allVideoClips: string[] = [];
    const allAudioClips: string[] = [];
    const place = async (trackId: string, m: { id: string; seconds: number }, start: number, duration: number) => {
      const dur = Math.min(duration, m.seconds - 2);
      const inPoint = between(0, Math.max(0, m.seconds - dur - 1));
      const clipId = crypto.randomUUID();
      const a = performance.now();
      const r = await st().executeAction({ type: "clip/add", params: { trackId, mediaId: m.id, startTime: start, clipId, duration: dur, inPoint, outPoint: inPoint + dur } });
      addTimes.push(performance.now() - a);
      if (!r.success) throw new Error(`clip/add failed: ${r.error?.message}`);
      return { id: clipId, start, duration: dur };
    };
    const nV1 = Math.max(4, Math.round(cfg.clips * 0.4));
    const nOver = Math.max(1, Math.round((cfg.clips * 0.2) / 5));
    const nAudio = Math.max(2, Math.round((cfg.clips * 0.4) / 8));
    const videoMedia = media.filter((m) => !/prores/.test(m.name));

    await stage("video-main", async () => {
      let t = 0;
      const avg = T / nV1;
      for (let i = 0; i < nV1; i++) {
        const m = videoMedia[i % videoMedia.length];
        const c = await place(trackIds.video[0], m, t, between(avg * 0.6, avg * 1.4 > 40 ? 40 : avg * 1.4));
        v1Clips.push(c);
        allVideoClips.push(c.id);
        t += c.duration;
      }
    });
    await stage("video-overlays", async () => {
      for (let tr = 1; tr < 6; tr++) {
        let t = between(5, 60);
        for (let i = 0; i < nOver; i++) {
          const m = videoMedia[(i + tr) % videoMedia.length];
          const c = await place(trackIds.video[tr], m, t, between(4, 14));
          allVideoClips.push(c.id);
          t += c.duration + between(T / nOver / 3, T / nOver);
        }
      }
    });
    await stage("audio", async () => {
      for (let tr = 0; tr < 8; tr++) {
        let t = between(0, 20);
        for (let i = 0; i < nAudio; i++) {
          const m = media[(i + tr) % media.length];
          const c = await place(trackIds.audio[tr], m, t, between(8, 40));
          allAudioClips.push(c.id);
          t += c.duration + between(0.5, Math.max(1, T / nAudio - 24));
        }
      }
    });

    // --- transitions between neighbouring V1 clips (each one undo step) -------------------------
    let transitions = 0;
    await stage("transitions", async () => {
      const types = ["crossfade", "dipToBlack", "wipe", "slide", "zoom", "push", "circleReveal", "dipToWhite"];
      const n = Math.min(Math.floor(v1Clips.length / 6), 60);
      for (let i = 0; i < n; i++) {
        const a = v1Clips[i * 6];
        const b = v1Clips[i * 6 + 1];
        const r = await st().executeAction({ type: "transition/add", params: { clipAId: a.id, clipBId: b.id, transitionType: types[i % types.length], duration: 0.8 } });
        if (r.success) transitions++;
      }
    });

    // --- effects + colour ------------------------------------------------------------------------
    let effects = 0;
    let colored = 0;
    await stage("effects-color", async () => {
      const every = Math.max(1, Math.floor(allVideoClips.length / 70));
      for (let i = 0; i < allVideoClips.length; i += every) {
        const id = allVideoClips[i];
        if (i % 3 === 0) {
          if (await st().addVideoEffect(id, "gaussian-blur", { radius: 2 })) effects++;
        } else if (i % 3 === 1) {
          if (await st().addVideoEffect(id, "glow", { radius: 12, intensity: 0.8, color: "#ffffff" })) effects++;
        }
        if (await st().updateColorGrading(id, { temperature: (i % 7) * 3 - 9, contrast: 6, saturation: 4 })) colored++;
      }
    });

    // --- titles (text clips) and Essential Graphics templates ------------------------------------
    let titles = 0;
    let graphics = 0;
    await stage("titles", async () => {
      const titleTrack = await st().addTrack("text", undefined, { name: "Titles" });
      void titleTrack;
      const tid = st().project.timeline.tracks.find((t: any) => t.name === "Titles")?.id;
      const n = Math.min(60, Math.max(3, Math.round(cfg.clips / 20)));
      for (let i = 0; i < n; i++) {
        const c = st().createTextClip(tid, (i + 0.5) * (T / n), `Chapter ${i + 1}: Soak Test Title`, 4, { fontSize: 64 });
        if (c) titles++;
      }
    });
    await stage("graphics", async () => {
      const tpl = E.graphics.getBuiltInGraphicTemplate("builtin-lt-classic-bar");
      const n = Math.min(40, Math.max(2, Math.round(cfg.clips / 30)));
      for (let i = 0; i < n; i++) {
        const r = await E.graphics.insertGraphic(tpl, { startTime: (i + 0.25) * (T / n), duration: 5 });
        if (r.ok) graphics++;
      }
    });

    // --- captions (SRT import, as the Captions panel does) ---------------------------------------
    let captions = 0;
    await stage("captions", async () => {
      const n = Math.min(300, Math.max(10, Math.round(cfg.clips / 3)));
      const ts = (s: number) => {
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000);
        const p = (x: number, w = 2) => String(x).padStart(w, "0");
        return `${p(h)}:${p(m)}:${p(sec)},${p(ms, 3)}`;
      };
      let srt = "";
      for (let i = 0; i < n; i++) {
        const s = (i + 0.1) * (T / n);
        srt += `${i + 1}\n${ts(s)} --> ${ts(s + 3.5)}\nCaption line ${i + 1} of the long-form soak test\n\n`;
      }
      const r = await st().importSRT(srt);
      if (!r.success) throw new Error(`importSRT: ${r.errors.join("; ")}`);
      // Captions are text clips (project.textClips) on the "Captions" track.
      const capTrack = st().project.timeline.tracks.find((t: any) => t.role === "captions");
      captions = (st().project.textClips ?? []).filter((c: any) => c.trackId === capTrack?.id).length;
    });

    // --- multicam clip ---------------------------------------------------------------------------
    let multicamSources = 0;
    await stage("multicam", async () => {
      const angles = media.filter((m) => !/prores|uhd/.test(m.name)).slice(0, 3);
      if (angles.length < 2) throw new Error("need >=2 non-4K sources for a multicam clip");
      E.timeline.getState().seekTo(T + 30);
      const created = await E.multicamController.createMulticamSourceCommand({
        name: "Soak multicam",
        syncMethod: "manual",
        angles: angles.map((a, i) => ({ mediaId: a.id, offset: i * 0.37 })),
        audio: { mode: "fixed", mediaId: angles[0].id },
        placeAtPlayhead: true,
      });
      if (!created.ok) throw new Error(created.message);
      multicamSources = (st().project.multicamSources ?? []).length;
    });

    // --- nests: three groups of 6 consecutive V1 clips -------------------------------------------
    let nests = 0;
    await stage("nests", async () => {
      for (let g = 0; g < 3; g++) {
        const group = v1Clips.slice(10 + g * 14, 10 + g * 14 + 6);
        if (group.length < 2) continue;
        E.ui.getState().clearSelection();
        for (const c of group) E.ui.getState().select({ type: "clip", id: c.id }, true);
        const r = await E.sequence.nestSelectedClips(`Nest ${g + 1}`);
        if (r?.ok !== false) nests++;
      }
      E.ui.getState().clearSelection();
    });

    // --- audio buses with repair effects ---------------------------------------------------------
    let buses = 0;
    let repairRacks = 0;
    await stage("buses", async () => {
      const R = E.routing;
      for (const [name, role] of [["Dialogue", "dialogue"], ["Music", "music"], ["FX", "effects"]] as const) {
        const plan = R.planAddBus(st().project.timeline, { name, role });
        if (plan.ok) await st().applyAudioRouting(plan);
      }
      const list = st().project.timeline.audioBuses ?? [];
      buses = list.length;
      for (let i = 0; i < trackIds.audio.length; i++) {
        const bus = list[i < 3 ? 0 : i < 6 ? 1 : 2];
        if (!bus) continue;
        const plan = R.planSetTrackOutput(st().project.timeline, trackIds.audio[i], bus.id);
        if (plan.ok) await st().applyAudioRouting(plan);
      }
      const { createRackEffect } = E.audio;
      for (const bus of list.slice(0, 2)) {
        await st().setAudioRack(bus.id, { effects: [createRackEffect("deHum"), createRackEffect("deEss"), createRackEffect("limiter")] });
        repairRacks++;
      }
    });

    E.timeline.getState().seekTo(0);
    const timeline = st().project.timeline;
    const countType = (t: string) => timeline.tracks.filter((x: any) => x.type === t).length;
    const clipsOf = (t: string) => timeline.tracks.filter((x: any) => x.type === t).reduce((n: number, x: any) => n + x.clips.length, 0);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const mediaIdsOut: Record<string, string> = {};
    for (const m of media) mediaIdsOut[m.name] = m.id;
    return {
      timelineSeconds: timeline.duration,
      clips: { video: clipsOf("video"), audio: clipsOf("audio"), total: clipsOf("video") + clipsOf("audio") },
      tracks: { video: countType("video"), audio: countType("audio"), other: timeline.tracks.length - countType("video") - countType("audio") },
      transitions,
      effects,
      colored,
      titles,
      graphics,
      captions,
      nests,
      multicamSources,
      buses,
      repairRacks,
      historyDepth: st().actionExecutor.getHistory().getUndoStackSize(),
      importMs: 0,
      buildMs: performance.now() - t0,
      addClipMsFirst100: mean(addTimes.slice(0, 100)),
      addClipMsLast100: mean(addTimes.slice(-100)),
      stageErrors: errors,
      mediaIds: mediaIdsOut,
    } satisfies BuildReport;
  }, input);
}
