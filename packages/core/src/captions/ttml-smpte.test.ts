import { describe, expect, it } from "vitest";
import { parseTtml } from "./ttml";

const doc = (attrs: string, begin: string, end: string) =>
  `<?xml version="1.0"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ${attrs}><body><div><p begin="${begin}" end="${end}">Hi</p></div></body></tt>`;

describe("TTML / iTT SMPTE time base", () => {
  const smpte = `ttp:timeBase="smpte" ttp:frameRate="30" ttp:frameRateMultiplier="1000 1001"`;

  it("reads non-drop frame labels at 29.97", () => {
    const r = parseTtml(doc(smpte, "00:01:00:02", "00:01:01:00"));
    expect(r.subtitles[0].startTime).toBeCloseTo((60 * 30 + 2) / (30000 / 1001), 2);
  });

  it("reads drop-frame labels (dropMode dropNTSC): 00:01:00:02 is frame 1800 and 00:10:00:00 is frame 17982", () => {
    const r = parseTtml(doc(`${smpte} ttp:dropMode="dropNTSC"`, "00:01:00:02", "00:10:00:00"));
    expect(r.errors).toEqual([]);
    expect(r.subtitles[0].startTime).toBeCloseTo(1800 / (30000 / 1001), 2);
    expect(r.subtitles[0].endTime).toBeCloseTo(17982 / (30000 / 1001), 2);
  });

  it("an iTT (iTunes Timed Text) file with frame times and a language is TTML", () => {
    const itt = `<?xml version="1.0" encoding="UTF-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="smpte" ttp:frameRate="24" xml:lang="fr"><body><div><p begin="00:00:01:12" end="00:00:02:00">Bonjour</p></div></body></tt>`;
    const r = parseTtml(itt);
    expect(r.subtitles[0].text).toBe("Bonjour");
    expect(r.subtitles[0].startTime).toBeCloseTo(1.5, 6);
    expect(r.subtitles[0].language).toBe("fr");
  });
});
