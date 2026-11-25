import { describe, expect, it } from "vitest";
import type { Subtitle } from "../types/timeline";
import { buildTranscript } from "./transcript";
import {
  SOURCE_TRANSCRIPT_VERSION,
  createSourceTranscriptRecord,
  editDistance,
  parseSourceSearchQuery,
  parseSourceTranscriptRecord,
  resolveCachedTranscript,
  searchSourceTranscripts,
  selectionToSourceMarks,
  sourceTranscriptOf,
  type SourceTranscriptEntry,
} from "./source-transcript";

const cue = (id: string, speaker: string, words: Array<[string, number, number]>): Subtitle => ({
  id,
  text: words.map((w) => w[0]).join(" "),
  startTime: words[0][1],
  endTime: words[words.length - 1][2],
  speaker,
  words: words.map(([text, startTime, endTime]) => ({ text, startTime, endTime })),
});

const CUES: Subtitle[] = [
  cue("a", "Ann", [["Welcome", 0.5, 0.9], ["to", 0.9, 1.0], ["the", 1.0, 1.1], ["show.", 1.1, 1.5]]),
  cue("b", "Bob", [["Thanks", 4.5, 5.0], ["for", 5.0, 5.2], ["having", 5.2, 5.6], ["me.", 5.6, 6.0]]),
];
const other: Subtitle[] = [
  cue("c", "Ann", [["The", 2, 2.2], ["transcript", 2.2, 2.9], ["editor", 2.9, 3.4], ["works.", 3.4, 3.9]]),
];

const entries = (): SourceTranscriptEntry[] => [
  { mediaId: "m1", mediaName: "Interview", transcript: buildTranscript(CUES) },
  { mediaId: "m2", mediaName: "Broll", transcript: buildTranscript(other) },
];

describe("source transcript records", () => {
  it("round-trips through JSON (save and reload) and keeps word timings", () => {
    const record = createSourceTranscriptRecord({ mediaHash: "h1", duration: 10, cues: CUES, engine: "import", language: "en", now: 5 });
    const reloaded = parseSourceTranscriptRecord(JSON.parse(JSON.stringify(record)));
    expect(reloaded).toEqual(record);
    expect(sourceTranscriptOf(reloaded!).words.map((w) => w.text)).toEqual(
      ["Welcome", "to", "the", "show.", "Thanks", "for", "having", "me."],
    );
  });

  it("drops malformed values and other versions instead of throwing", () => {
    expect(parseSourceTranscriptRecord(null)).toBeNull();
    expect(parseSourceTranscriptRecord("x")).toBeNull();
    expect(parseSourceTranscriptRecord({ version: 99, mediaHash: "h", cues: CUES })).toBeNull();
    expect(parseSourceTranscriptRecord({ version: SOURCE_TRANSCRIPT_VERSION, mediaHash: "", cues: CUES })).toBeNull();
    expect(parseSourceTranscriptRecord({ version: SOURCE_TRANSCRIPT_VERSION, mediaHash: "h", cues: [{ text: 1 }] })).toBeNull();
  });

  it("filters out bad cues but keeps the good ones", () => {
    const record = parseSourceTranscriptRecord({
      version: SOURCE_TRANSCRIPT_VERSION,
      mediaHash: "h",
      cues: [{ id: "x", text: "ok", startTime: 0, endTime: 1 }, { text: "bad", startTime: 2, endTime: 1 }, 7],
    });
    expect(record?.cues.map((c) => c.id)).toEqual(["x"]);
  });
});

describe("cache invalidation", () => {
  const record = createSourceTranscriptRecord({ mediaHash: "h1", duration: 10, cues: CUES, engine: "import" });

  it("uses the record when the media hash still matches", () => {
    expect(resolveCachedTranscript(record, "h1", 10).status).toBe("ready");
    expect(resolveCachedTranscript(record, "h1", 10.05).record).toEqual(record);
  });

  it("invalidates when the media was relinked to different content", () => {
    expect(resolveCachedTranscript(record, "h2", 10)).toEqual({ status: "relinked", record: null });
  });

  it("invalidates when the same hash reports a very different duration", () => {
    expect(resolveCachedTranscript(record, "h1", 25).status).toBe("relinked");
  });

  it("does not trust a transcript while the media is offline", () => {
    expect(resolveCachedTranscript(record, null).status).toBe("relinked");
  });

  it("old projects with nothing stored report missing, not an error", () => {
    expect(resolveCachedTranscript(undefined, "h1")).toEqual({ status: "missing", record: null });
    expect(resolveCachedTranscript(null, "h1").status).toBe("missing");
    expect(resolveCachedTranscript({ junk: true }, "h1").status).toBe("invalid");
  });
});

describe("range selection to in/out", () => {
  const transcript = buildTranscript(CUES);

  it("maps a word selection to the first word's start and last word's end", () => {
    expect(selectionToSourceMarks(transcript, 1, 3)).toEqual({ in: 0.9, out: 1.5 });
  });

  it("accepts a selection dragged backwards", () => {
    expect(selectionToSourceMarks(transcript, 3, 1)).toEqual({ in: 0.9, out: 1.5 });
  });

  it("pads and clamps to the media", () => {
    expect(selectionToSourceMarks(transcript, 0, 0, { pad: 1 })).toEqual({ in: 0, out: 1.9 });
    expect(selectionToSourceMarks(transcript, 7, 7, { pad: 1, duration: 6.5 })).toEqual({ in: 4.6, out: 6.5 });
  });

  it("refuses an empty transcript or out-of-media selection", () => {
    expect(() => selectionToSourceMarks({ words: [], sentences: [] }, 0, 0)).toThrow();
    expect(() => selectionToSourceMarks(transcript, 7, 7, { duration: 3 })).toThrow();
  });
});

describe("project-wide search", () => {
  it("finds a word in every asset, in asset order", () => {
    const hits = searchSourceTranscripts(entries(), "the");
    expect(hits.map((h) => [h.mediaId, h.match])).toEqual([["m1", "the"], ["m2", "The"]]);
    expect(hits[0].time).toBe(1.0);
  });

  it("finds a phrase and reports the jump time, range and context", () => {
    const [hit] = searchSourceTranscripts(entries(), "welcome to the", { contextWords: 2 });
    expect(hit).toMatchObject({ mediaId: "m1", wordStart: 0, wordEnd: 2, time: 0.5, start: 0.5, end: 1.1, match: "Welcome to the", before: "", after: "show. Thanks" });
  });

  it("matches a lone token inside a word and ignores punctuation", () => {
    expect(searchSourceTranscripts(entries(), "tran")[0].mediaId).toBe("m2");
    expect(searchSourceTranscripts(entries(), "SHOW")[0].match).toBe("show.");
  });

  it("filters by speaker, from the query or the option", () => {
    expect(searchSourceTranscripts(entries(), "speaker:Bob for").map((h) => h.match)).toEqual(["for"]);
    expect(searchSourceTranscripts(entries(), "the", { speaker: "ann" }).map((h) => h.mediaId)).toEqual(["m1", "m2"]);
    expect(searchSourceTranscripts(entries(), "speaker:Bob the")).toEqual([]);
  });

  it("lists a speaker's sentences when there is no phrase", () => {
    const hits = searchSourceTranscripts(entries(), 'speaker:"Bob"');
    expect(hits.map((h) => h.match)).toEqual(["Thanks for having me."]);
  });

  it("fuzzy finds near misses after the exact hits, and exact search does not", () => {
    expect(searchSourceTranscripts(entries(), "transcrpt editr")).toEqual([]);
    const hits = searchSourceTranscripts(entries(), "transcrpt editr", { fuzzy: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ mediaId: "m2", match: "transcript editor", score: 2 });
    const mixed = searchSourceTranscripts(entries(), "show", { fuzzy: true });
    expect(mixed[0].score).toBe(0);
  });

  it("keeps short words exact when fuzzy", () => {
    expect(searchSourceTranscripts(entries(), "tho", { fuzzy: true })).toEqual([]);
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(searchSourceTranscripts(entries(), "   ")).toEqual([]);
    expect(searchSourceTranscripts(entries(), "the", { limit: 1 })).toHaveLength(1);
  });

  it("parses speaker syntax and measures edit distance", () => {
    expect(parseSourceSearchQuery('hello speaker:"Ann Lee" world')).toEqual({ phrase: "hello world", speaker: "Ann Lee" });
    expect(parseSourceSearchQuery("plain words")).toEqual({ phrase: "plain words" });
    expect(editDistance("kitten", "sitting", 5)).toBe(3);
    expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
  });
});
