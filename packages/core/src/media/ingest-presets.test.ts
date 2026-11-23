import { describe, expect, it } from "vitest";
import {
  BUILTIN_INGEST_PRESETS,
  DEFAULT_INGEST_PRESET_ID,
  MAX_USER_PRESETS,
  allIngestPresets,
  createIngestPreset,
  deleteIngestPreset,
  duplicateIngestPreset,
  findIngestPreset,
  ingestModeOf,
  ingestModeSettings,
  normalizeProxyProfile,
  presetMatchingProfile,
  renameIngestPreset,
  resolveBatchProfile,
  sameProxyProfile,
  sanitizeUserPresets,
  serializeUserPresets,
  updateIngestPresetProfile,
  validatePresetName,
  type ProxyPresetEntry,
} from "./ingest-presets";
import {
  DEFAULT_DESKTOP_PROXY_PROFILE,
  desktopProxyDimensions,
  desktopProxyFileName,
  isDesktopIngestConfig,
  isDesktopProxyProfile,
  relinkNameKey,
  describeDesktopProxyProfile,
} from "./desktop-ingest";
import type { DesktopProxyProfile } from "../types/project";

const profile: DesktopProxyProfile = { codec: "prores-lt", size: "custom", customWidth: 1280, audio: "strip", burnIn: { clipName: true, timecode: true }, destination: { mode: "custom", folder: "/Volumes/Fast" } };
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
};

describe("built-in presets", () => {
  it("cover ProRes Proxy / LT / 422, H.264, DNxHR LB / SQ, sizes, audio and burn-in, and are all valid profiles", () => {
    expect(new Set(BUILTIN_INGEST_PRESETS.map((p) => p.profile.codec))).toEqual(new Set(["prores-proxy", "prores-lt", "prores-422", "h264", "dnxhr-lb", "dnxhr-sq"]));
    expect(BUILTIN_INGEST_PRESETS.some((p) => p.profile.burnIn?.clipName && p.profile.burnIn.timecode)).toBe(true);
    for (const preset of BUILTIN_INGEST_PRESETS) {
      expect(preset.builtIn).toBe(true);
      expect(isDesktopProxyProfile(preset.profile)).toBe(true);
    }
    expect(new Set(BUILTIN_INGEST_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_INGEST_PRESETS.length);
    expect(new Set(BUILTIN_INGEST_PRESETS.map((p) => p.name)).size).toBe(BUILTIN_INGEST_PRESETS.length);
    expect(findIngestPreset([], DEFAULT_INGEST_PRESET_ID)?.profile).toEqual({ codec: "h264", size: "half" });
  });
});

describe("profile validation", () => {
  it("accepts every size, custom widths in range, audio, burn-in and destinations", () => {
    expect(isDesktopProxyProfile(profile)).toBe(true);
    expect(isDesktopProxyProfile({ codec: "h264", size: "full" })).toBe(true);
    expect(isDesktopProxyProfile({ codec: "dnxhr-sq", size: "quarter", destination: { mode: "media" } })).toBe(true);
  });
  it("rejects bad combinations", () => {
    const bad: unknown[] = [
      { codec: "prores-4444", size: "half" },
      { codec: "h264", size: "custom" },
      { codec: "h264", size: "custom", customWidth: 8 },
      { codec: "h264", size: "custom", customWidth: 100.5 },
      { codec: "h264", size: "custom", customWidth: 99999 },
      { codec: "h264", size: "half", customWidth: 640 },
      { codec: "h264", size: "half", audio: "mute" },
      { codec: "h264", size: "half", burnIn: { clipName: "yes" } },
      { codec: "h264", size: "half", burnIn: null },
      { codec: "h264", size: "half", destination: { mode: "custom" } },
      { codec: "h264", size: "half", destination: { mode: "custom", folder: "  " } },
      { codec: "h264", size: "half", destination: { mode: "media", folder: "/x" } },
      { codec: "h264", size: "half", destination: { mode: "cloud" } },
      null,
      "h264",
    ];
    for (const value of bad) expect(isDesktopProxyProfile(value), JSON.stringify(value)).toBe(false);
  });
  it("project ingest config accepts the checksum and preset id, and rejects unknown checksums", () => {
    expect(isDesktopIngestConfig({ checksum: "md5", proxyPresetId: "user-1", proxyProfile: profile })).toBe(true);
    expect(isDesktopIngestConfig({ checksum: "crc32" })).toBe(false);
    expect(isDesktopIngestConfig({ proxyPresetId: "" })).toBe(false);
  });
  it("sizes: full, half, quarter, fixed height, custom width (never upscaled)", () => {
    expect(desktopProxyDimensions(3840, 2160, "full")).toEqual({ width: 3840, height: 2160 });
    expect(desktopProxyDimensions(3840, 2160, "custom", 1000)).toEqual({ width: 1000, height: 562 });
    expect(desktopProxyDimensions(1280, 720, "custom", 4000)).toEqual({ width: 1280, height: 720 });
    expect(desktopProxyDimensions(1080, 1920, "custom", 540)).toEqual({ width: 540, height: 960 });
  });
  it("describes a profile for the panel", () => {
    expect(describeDesktopProxyProfile(profile)).toBe("ProRes 422 LT (.mov) · 1280 px wide · no audio · burn-in");
  });
});

describe("compare profiles", () => {
  it("treats default fields as absent", () => {
    expect(sameProxyProfile({ codec: "h264", size: "half" }, { codec: "h264", size: "half", audio: "keep", burnIn: {}, destination: { mode: "project" } })).toBe(true);
    expect(sameProxyProfile({ codec: "h264", size: "half" }, { codec: "h264", size: "half", audio: "strip" })).toBe(false);
    expect(sameProxyProfile({ codec: "h264", size: "half" }, { codec: "h264", size: "half", burnIn: { timecode: true } })).toBe(false);
    expect(normalizeProxyProfile({ codec: "h264", size: "half", audio: "keep", burnIn: { clipName: false } })).toEqual({ codec: "h264", size: "half" });
  });
  it("finds the preset a project's stored profile came from, preferring the remembered id", () => {
    const user = ok(createIngestPreset([], "Mine", { codec: "h264", size: "half" }, "user-1")).presets;
    expect(presetMatchingProfile(user, { codec: "h264", size: "half" })?.id).toBe("h264-half");
    expect(presetMatchingProfile(user, { codec: "h264", size: "half" }, "user-1")?.id).toBe("user-1");
    expect(presetMatchingProfile(user, { codec: "h264", size: "half" }, "gone")?.id).toBe("h264-half");
    expect(presetMatchingProfile(user, { codec: "h264", size: "1080p" })).toBeUndefined();
  });
});

describe("create, duplicate, rename, update, delete", () => {
  it("creates a user preset with a normalised profile and keeps built-ins out of the stored list", () => {
    const r = ok(createIngestPreset([], "  Dailies  ", profile, "user-a"));
    expect(r.preset).toEqual({ id: "user-a", name: "Dailies", builtIn: false, profile });
    expect(allIngestPresets(r.presets)).toHaveLength(BUILTIN_INGEST_PRESETS.length + 1);
    expect(r.presets).toHaveLength(1);
  });
  it("refuses empty, long and duplicate names (case-insensitive, built-in names included) and invalid profiles", () => {
    expect(createIngestPreset([], "   ", profile).ok).toBe(false);
    expect(createIngestPreset([], "x".repeat(61), profile).ok).toBe(false);
    expect(validatePresetName("prores proxy", [])).toMatch(/already exists/);
    const user = ok(createIngestPreset([], "Dailies", profile, "user-a")).presets;
    expect(createIngestPreset(user, "DAILIES", profile).ok).toBe(false);
    expect(createIngestPreset([], "Bad", { codec: "h264", size: "custom" } as DesktopProxyProfile).ok).toBe(false);
  });
  it("limits how many presets a user can keep", () => {
    let user: ProxyPresetEntry[] = [];
    for (let i = 0; i < MAX_USER_PRESETS; i++) user = ok(createIngestPreset(user, `P${i}`, profile, `user-${i}`)).presets;
    const over = createIngestPreset(user, "One more", profile);
    expect(over.ok).toBe(false);
  });
  it("duplicates a built-in into an editable user preset with a unique name", () => {
    const first = ok(duplicateIngestPreset([], "prores-proxy", undefined, "user-1"));
    expect(first.preset.name).toBe("ProRes Proxy copy");
    expect(first.preset.builtIn).toBe(false);
    expect(first.preset.profile).toEqual({ codec: "prores-proxy", size: "half" });
    const second = ok(duplicateIngestPreset(first.presets, "prores-proxy", undefined, "user-2"));
    expect(second.preset.name).toBe("ProRes Proxy copy 2");
    expect(duplicateIngestPreset([], "nope").ok).toBe(false);
    expect(ok(duplicateIngestPreset(first.presets, "user-1", "Named", "user-3")).preset.name).toBe("Named");
  });
  it("renames and edits only user presets", () => {
    const user = ok(createIngestPreset([], "Dailies", profile, "user-a")).presets;
    expect(ok(renameIngestPreset(user, "user-a", "Rushes")).preset.name).toBe("Rushes");
    expect(renameIngestPreset(user, "user-a", "ProRes Proxy").ok).toBe(false);
    expect(ok(renameIngestPreset(user, "user-a", "dailies")).preset.name).toBe("dailies"); // its own name, other case
    const built = renameIngestPreset(user, "h264-half", "Mine");
    expect(built.ok).toBe(false);
    expect(!built.ok && built.error).toMatch(/Built-in/);
    const edited = ok(updateIngestPresetProfile(user, "user-a", { codec: "h264", size: "720p" }));
    expect(edited.preset.profile).toEqual({ codec: "h264", size: "720p" });
    expect(updateIngestPresetProfile(user, "prores-proxy", { codec: "h264", size: "720p" }).ok).toBe(false);
    expect(updateIngestPresetProfile(user, "user-a", { codec: "h264", size: "custom" } as DesktopProxyProfile).ok).toBe(false);
    expect(renameIngestPreset(user, "ghost", "x").ok).toBe(false);
  });
  it("deletes user presets, never built-ins", () => {
    const user = ok(createIngestPreset([], "Dailies", profile, "user-a")).presets;
    expect(ok(deleteIngestPreset(user, "user-a")).presets).toEqual([]);
    const built = deleteIngestPreset(user, "dnxhr-lb");
    expect(!built.ok && built.error).toMatch(/Built-in/);
    expect(deleteIngestPreset(user, "ghost").ok).toBe(false);
  });
});

describe("persistence format", () => {
  it("round-trips through JSON", () => {
    const user = ok(createIngestPreset([], "Dailies", profile, "user-a")).presets;
    const stored = JSON.parse(JSON.stringify(serializeUserPresets(user)));
    expect(stored.version).toBe(1);
    expect(sanitizeUserPresets(stored)).toEqual(user);
  });
  it("drops what cannot be trusted: garbage, bad profiles, built-in ids, duplicate ids, and renames a name that collides", () => {
    const good = { id: "user-a", name: "Dailies", profile: { codec: "h264", size: "half" } };
    const out = sanitizeUserPresets({
      presets: [
        good,
        { ...good },
        { id: "h264-half", name: "Hijack", profile: { codec: "h264", size: "half" } },
        { id: "user-b", name: "", profile: { codec: "h264", size: "half" } },
        { id: "user-c", name: "Bad", profile: { codec: "h264", size: "custom" } },
        { id: 7, name: "Num", profile: { codec: "h264", size: "half" } },
        null,
        "x",
        { id: "user-d", name: "ProRes Proxy", profile: { codec: "h264", size: "quarter" } },
      ],
    });
    expect(out.map((p) => p.id)).toEqual(["user-a", "user-d"]);
    expect(out[1].name).toBe("ProRes Proxy (2)");
    expect(sanitizeUserPresets(null)).toEqual([]);
    expect(sanitizeUserPresets("junk")).toEqual([]);
    expect(sanitizeUserPresets([good])).toHaveLength(1);
  });
});

describe("ingest settings: none / copy / copy and create proxies / create proxies", () => {
  const library = (ingestPreset?: "none" | "proxies" | "copy", proxiesWithCopy?: boolean) => ({ mediaLibrary: { items: [], ...(ingestPreset ? { ingestPreset } : {}), ...(proxiesWithCopy !== undefined ? { desktopIngest: { proxiesWithCopy } } : {}) } });
  it("maps the stored preset and flag to one of four modes and back", () => {
    expect(ingestModeOf(library())).toBe("none");
    expect(ingestModeOf(library("proxies"))).toBe("proxies");
    expect(ingestModeOf(library("copy"))).toBe("copy");
    expect(ingestModeOf(library("copy", false))).toBe("copy");
    expect(ingestModeOf(library("copy", true))).toBe("copy-proxies");
    for (const mode of ["none", "copy", "copy-proxies", "proxies"] as const) {
      const s = ingestModeSettings(mode);
      expect(ingestModeOf(library(s.ingestPreset, s.proxiesWithCopy))).toBe(mode);
    }
  });
  it("a batch profile wins, then the project's, then the default", () => {
    const project = { mediaLibrary: { items: [], desktopIngest: { proxyProfile: { codec: "dnxhr-lb", size: "half" } as DesktopProxyProfile } } };
    expect(resolveBatchProfile(project, { codec: "h264", size: "quarter" })).toEqual({ codec: "h264", size: "quarter" });
    expect(resolveBatchProfile(project).codec).toBe("dnxhr-lb");
    expect(resolveBatchProfile({ mediaLibrary: { items: [] } })).toEqual(DEFAULT_DESKTOP_PROXY_PROFILE);
  });
});

describe("proxy file names for presets", () => {
  const item = { id: "abcdef123456", name: "Interview A.mov" };
  it("keep a unique name per preset and pair back to the clip by name", () => {
    const names = BUILTIN_INGEST_PRESETS.map((p) => desktopProxyFileName(item, p.profile));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(relinkNameKey(name, true)).toBe("interview a");
    expect(relinkNameKey(desktopProxyFileName(item, profile), true)).toBe("interview a");
    expect(desktopProxyFileName(item, { codec: "h264", size: "half" })).toBe("Interview A-abcdef12_half_proxy.mp4");
  });
});
