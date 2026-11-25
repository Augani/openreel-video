import { describe, expect, it } from "vitest";
import type { Marker } from "../types/timeline";
import {
  chaptersToFfMetadata,
  chaptersToWebVtt,
  chaptersToYouTubeText,
  deliveryChapters,
  parseFfMetadataChapters,
  vttTimestamp,
} from "./chapters";

const m = (id: string, time: number, label: string, kind?: Marker["kind"]): Marker => ({ id, time, label, color: "#fff", ...(kind ? { kind } : {}) });
const markers = [
  m("1", 0, "Cold open", "chapter"),
  m("2", 12.5, "Act one", "chapter"),
  m("c", 20, "Fix this shot"),
  m("3", 95.25, "Act two: the = twist; #4", "chapter"),
];

describe("chapters from markers", () => {
  it("uses only chapter markers and ends each chapter where the next starts", () => {
    const chapters = deliveryChapters(markers, 120);
    expect(chapters).toEqual([
      { start: 0, end: 12.5, title: "Cold open" },
      { start: 12.5, end: 95.25, title: "Act one" },
      { start: 95.25, end: 120, title: "Act two: the = twist; #4" },
    ]);
  });

  it("cuts to an export range and shifts times to the file start", () => {
    const chapters = deliveryChapters(markers, 120, { startTime: 10, endTime: 100 });
    expect(chapters.map((c) => [c.start, c.end, c.title])).toEqual([
      [2.5, 85.25, "Act one"],
      [85.25, 90, "Act two: the = twist; #4"],
    ]);
  });

  it("drops chapters at the same instant and names untitled ones", () => {
    const chapters = deliveryChapters([m("a", 5, "", "chapter"), m("b", 5.0004, "dup", "chapter")], 30);
    expect(chapters).toEqual([{ start: 5, end: 30, title: "Chapter 1" }]);
    expect(deliveryChapters([m("x", 1, "comment only")], 30)).toEqual([]);
  });
});

describe("ffmpeg metadata (MP4 chapter atoms)", () => {
  it("writes [CHAPTER] blocks in milliseconds, escapes special characters and reads back", () => {
    const chapters = deliveryChapters(markers, 120);
    const text = chaptersToFfMetadata(chapters);
    expect(text.startsWith(";FFMETADATA1\n")).toBe(true);
    expect(text).toContain("[CHAPTER]\nTIMEBASE=1/1000\nSTART=12500\nEND=95250\ntitle=Act one");
    expect(text).toContain("title=Act two: the \\= twist\\; \\#4");
    expect(parseFfMetadataChapters(text)).toEqual(chapters);
  });
});

describe("WebVTT chapters", () => {
  it("is a WEBVTT file with one numbered cue per chapter", () => {
    expect(vttTimestamp(3725.5)).toBe("01:02:05.500");
    const vtt = chaptersToWebVtt(deliveryChapters(markers, 120));
    expect(vtt).toBe(
      [
        "WEBVTT",
        "",
        "1",
        "00:00:00.000 --> 00:00:12.500",
        "Cold open",
        "",
        "2",
        "00:00:12.500 --> 00:01:35.250",
        "Act one",
        "",
        "3",
        "00:01:35.250 --> 00:02:00.000",
        "Act two: the = twist; #4",
        "",
      ].join("\n"),
    );
  });

  it("escapes markup and the cue arrow in titles", () => {
    const vtt = chaptersToWebVtt([{ start: 0, end: 5, title: "A <b> --> & C" }]);
    expect(vtt).toContain("A &lt;b> --&gt; &amp; C");
  });
});

describe("YouTube chapter text", () => {
  it("is m:ss / h:mm:ss lines starting at 0:00", () => {
    expect(chaptersToYouTubeText(deliveryChapters(markers, 4000))).toBe("0:00 Cold open\n0:12 Act one\n1:35 Act two: the = twist; #4");
    expect(chaptersToYouTubeText([{ start: 3700, end: 3800, title: "Late" }])).toBe("0:00 Intro\n1:01:40 Late");
  });
});
