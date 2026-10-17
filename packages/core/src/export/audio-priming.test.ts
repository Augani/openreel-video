import { describe, expect, it } from "vitest";
import { measureSignalDelay } from "./audio-priming";

describe("audio encoder timing measurement", () => {
  const reference = Float32Array.from({ length: 1500 }, (_, i) => i >= 100 && i < 700 ? Math.sin(i * i * 0.001) * 0.6 : 0);
  it.each([0, 64, 211, 512])("measures %i samples of priming without using a platform constant", (delay) => {
    const decoded = new Float32Array(reference.length + delay);
    for (let i = 0; i < reference.length; i++) decoded[i + delay] = reference[i]! * 0.7;
    expect(measureSignalDelay(reference, decoded, 100, 600, 600)).toBe(delay);
  });
  it("rejects silence rather than assuming zero delay", () => {
    expect(() => measureSignalDelay(reference, new Float32Array(2000), 100, 600, 600)).toThrow("Could not verify");
  });
});
