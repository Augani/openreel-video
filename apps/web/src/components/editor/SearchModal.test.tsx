import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { SearchModal } from "./SearchModal";

describe("SearchModal inspector routing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUIStore.setState({
      selectedItems: [{ type: "text-clip", id: "text-1" }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-testid="search-target"]').forEach((node) =>
      node.remove(),
    );
  });

  it("discovers text shader materials and expands only the section header", () => {
    const section = document.createElement("section");
    section.dataset.testid = "search-target";
    section.dataset.sectionId = "text-properties";
    const header = document.createElement("div");
    header.dataset.slot = "toolcraft-panel-section-header";
    header.setAttribute("aria-expanded", "false");
    const headerClick = vi.fn();
    header.addEventListener("click", headerClick);
    const childButton = document.createElement("button");
    const childClick = vi.fn();
    childButton.addEventListener("click", childClick);
    section.append(header, childButton);
    document.body.append(section);
    section.scrollIntoView = vi.fn();

    const onClose = vi.fn();
    render(<SearchModal isOpen onClose={onClose} />);

    expect(screen.getByText("Text Materials & Shaders")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open Text Materials & Shaders" }),
    );
    act(() => vi.advanceTimersByTime(100));

    expect(headerClick).toHaveBeenCalledOnce();
    expect(childClick).not.toHaveBeenCalled();
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("classifies ordinary clips from their project track instead of assuming video", () => {
    const project = createEmptyProject("Search routing");
    useProjectStore.setState({
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          tracks: [
            {
              id: "audio-track",
              name: "Voiceover",
              type: "audio",
              clips: [
                {
                  id: "audio-clip",
                  mediaId: "audio-media",
                  trackId: "audio-track",
                  startTime: 0,
                  duration: 4,
                  inPoint: 0,
                  outPoint: 4,
                  speed: 1,
                  volume: 1,
                  transform: {
                    position: { x: 0, y: 0 },
                    scale: { x: 1, y: 1 },
                    rotation: 0,
                    anchor: { x: 0.5, y: 0.5 },
                    opacity: 1,
                  },
                  effects: [],
                  audioEffects: [],
                  keyframes: [],
                },
              ],
              transitions: [],
              muted: false,
              locked: false,
              hidden: false,
              solo: false,
            },
          ],
        },
      },
    });
    useUIStore.setState({
      selectedItems: [{ type: "clip", id: "audio-clip" }],
    });

    render(<SearchModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText("Audio Effects")).toBeInTheDocument();
    expect(screen.queryByText("Visual Effects")).toBeNull();
    expect(screen.getByText(/selected audio clip/i)).toBeInTheDocument();
  });
});
