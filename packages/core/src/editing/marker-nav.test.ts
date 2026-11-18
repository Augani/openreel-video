import { describe, expect, it } from "vitest";
import type { Marker } from "../types/timeline";
import { markerAt, markersInRange, nextMarker, prevMarker } from "./marker-nav";

const mk = (id: string, time: number, extra: Partial<Marker> = {}): Marker => ({ id, time, label: id, color: "#fff", ...extra });
const markers = [mk("c", 9, { kind: "chapter" }), mk("a", 2), mk("b", 5, { kind: "chapter" }), mk("d", 12, { duration: 3 })];

describe("marker navigation", () => {
  it("goes to the next marker strictly after the playhead", () => {
    expect(nextMarker(markers, 0)?.id).toBe("a");
    expect(nextMarker(markers, 3)?.id).toBe("b");
  });
  it("at a marker boundary skips that marker", () => {
    expect(nextMarker(markers, 5)?.id).toBe("c");
    expect(prevMarker(markers, 5)?.id).toBe("a");
    expect(nextMarker(markers, 5 - 1e-9)?.id).toBe("c");
  });
  it("goes to the previous marker between markers", () => {
    expect(prevMarker(markers, 7)?.id).toBe("b");
    expect(prevMarker(markers, 100)?.id).toBe("d");
  });
  it("returns null past the ends and with no markers", () => {
    expect(nextMarker(markers, 12)).toBeNull();
    expect(prevMarker(markers, 2)).toBeNull();
    expect(nextMarker([], 0)).toBeNull();
    expect(prevMarker([], 10)).toBeNull();
  });
  it("filters by kind, treating a missing kind as comment", () => {
    expect(nextMarker(markers, 0, { kind: "chapter" })?.id).toBe("b");
    expect(prevMarker(markers, 100, { kind: "chapter" })?.id).toBe("c");
    expect(nextMarker(markers, 0, { kind: "comment" })?.id).toBe("a");
    expect(nextMarker(markers, 0, { kind: "web" })).toBeNull();
  });
  it("lists markers overlapping a range, including range markers that span it", () => {
    expect(markersInRange(markers, 4, 9).map((m) => m.id)).toEqual(["b", "c"]);
    expect(markersInRange(markers, 13, 14).map((m) => m.id)).toEqual(["d"]);
    expect(markersInRange(markers, 9, 4).map((m) => m.id)).toEqual(["b", "c"]);
    expect(markersInRange(markers, 20, 30)).toEqual([]);
  });
  it("finds the marker under a time", () => {
    expect(markerAt(markers, 13)?.id).toBe("d");
    expect(markerAt(markers, 5)?.id).toBe("b");
    expect(markerAt(markers, 6)).toBeNull();
  });
});
