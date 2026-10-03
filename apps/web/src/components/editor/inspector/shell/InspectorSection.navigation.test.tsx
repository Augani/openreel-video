import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useInspectorNavigationStore } from "../../../../stores/inspector-navigation-store";
import { useUIStore } from "../../../../stores/ui-store";
import { InspectorSection } from "./InspectorSection";

describe("Inspector section navigation", () => {
  afterEach(() => {
    cleanup();
    useInspectorNavigationStore.getState().clearRequest();
    useUIStore.getState().clearSelection();
  });

  it("expands and focuses the requested tool for the selected clip", async () => {
    useUIStore.getState().select({ type: "clip", id: "selected", trackId: "track" });
    render(<InspectorSection title="Captions" sectionId="captions"><p>Caption tools</p></InspectorSection>);
    expect(screen.queryByText("Caption tools")).toBeNull();
    act(() => useInspectorNavigationStore.getState().requestSection("captions", "selected"));
    expect(screen.getByText("Caption tools")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Collapse Captions section" })).toHaveFocus());
  });

  it("does not open a request belonging to another clip or section", () => {
    useUIStore.getState().select({ type: "clip", id: "selected", trackId: "track" });
    render(<InspectorSection title="Captions" sectionId="captions"><p>Caption tools</p></InspectorSection>);
    act(() => useInspectorNavigationStore.getState().requestSection("captions", "previous"));
    expect(screen.queryByText("Caption tools")).toBeNull();
    act(() => useInspectorNavigationStore.getState().requestSection("reframe", "selected"));
    expect(screen.queryByText("Caption tools")).toBeNull();
  });
});
