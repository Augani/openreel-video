import { describe, expect, it } from "vitest";
import { encodeWav16, transcribePoints, wordsToCaptions, type Word } from "./transcribe";

describe("encodeWav16", () => {
  it("writes a 16 kHz mono PCM WAV the server can measure", async () => {
    const wav = encodeWav16(new Float32Array(16000));
    expect(wav.type).toBe("audio/wav");
    expect(wav.size).toBe(44 + 32000);
  });
});

describe("transcribePoints", () => {
  it("charges every started minute, at least one", () => {
    expect(transcribePoints(10, 1)).toBe(1);
    expect(transcribePoints(60.3, 1)).toBe(1);
    expect(transcribePoints(70, 1)).toBe(2);
    expect(transcribePoints(70, 0.5)).toBe(1);
  });
});

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe("wordsToCaptions", () => {
  const words = [
    w("إذن", 0.16, 0.48), w("المجموع", 0.86, 1.36), w("أربعون", 1.4, 1.76), w("دينار.", 1.88, 2.2),
    w("تفضل", 2.5, 2.8), w("هذا.", 2.85, 3.1),
    w("أحسنت", 4.2, 4.6), w("يا", 4.65, 4.75), w("فوزية.", 4.8, 5.3),
  ];

  it("breaks lines at punctuation and pauses, on the clip's timeline position", () => {
    const lines = wordsToCaptions(words, { startTime: 10, duration: 10 });
    expect(lines.map((l) => l.text)).toEqual(["إذن المجموع أربعون دينار.", "تفضل هذا.", "أحسنت يا فوزية."]);
    expect(lines[0].startTime).toBeCloseTo(10.16);
    expect(lines[0].endTime).toBeCloseTo(12.35);
    expect(lines[1].endTime).toBeCloseTo(13.25);
  });

  it("caps words per line and never runs past the next line or the clip end", () => {
    const many = Array.from({ length: 7 }, (_, i) => w(`كلمة${i}`, i * 0.3, i * 0.3 + 0.25));
    const lines = wordsToCaptions(many, { startTime: 0, duration: 1.5 }, 3);
    expect(lines.map((l) => l.text.split(" ").length)).toEqual([3, 3]); // the 7th word starts after the clip ends
    expect(lines[0].endTime).toBeLessThanOrEqual(lines[1].startTime);
    expect(Math.max(...lines.map((l) => l.endTime))).toBeLessThanOrEqual(1.5);
  });

  it("maps source time through the clip speed", () => {
    const lines = wordsToCaptions([w("سريع", 2, 2.4)], { startTime: 5, duration: 10, speed: 2 });
    expect(lines[0].startTime).toBeCloseTo(6);
  });
});
