import { describe, expect, it } from "vitest";
import { MPEG_5_1_INPUT_ORDER, inputOrderFromProbe, isPermutation, reorderChannels } from "./aac-surround-order";

describe("six-channel AAC input order", () => {
  it("MPEG order puts C L R Ls Rs LFE into the encoder, from a mix in L R C LFE Ls Rs order", () => {
    const mix = ["L", "R", "C", "LFE", "Ls", "Rs"];
    expect(reorderChannels(mix, MPEG_5_1_INPUT_ORDER)).toEqual(["C", "L", "R", "Ls", "Rs", "LFE"]);
    expect(isPermutation(MPEG_5_1_INPUT_ORDER)).toBe(true);
  });

  it("derives the input order from what a probe heard on each decoded channel", () => {
    // Measured in Chrome: the decoded L carried probe slot 1, R slot 2, C slot 0, LFE slot 5, Ls slot 3, Rs slot 4.
    const heard = [1, 2, 0, 5, 3, 4];
    const order = inputOrderFromProbe(heard)!;
    expect(order).toEqual([2, 0, 1, 4, 5, 3]);
    // Round trip: feeding the reordered mix through the same rotation returns the mix unchanged.
    const mix = ["L", "R", "C", "LFE", "Ls", "Rs"];
    const encoderInput = reorderChannels(mix, order);
    const decoded = heard.map((slot) => encoderInput[slot]);
    expect(decoded).toEqual(mix);
  });

  it("an encoder that already reads the mix order needs no reordering", () => {
    expect(inputOrderFromProbe([0, 1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("rejects a probe that is not a permutation (silence, duplicates)", () => {
    expect(inputOrderFromProbe([0, 0, 1, 2, 3, 4])).toBeNull();
    expect(inputOrderFromProbe([-1, 1, 2, 3, 4, 5])).toBeNull();
    expect(inputOrderFromProbe([0, 1, 2])).toBeNull();
  });
});
