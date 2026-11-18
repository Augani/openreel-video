import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionExecutor, type Marker } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { CommentsPanel } from "./CommentsPanel";

const comment = (id: string, time: number, text: string, extra: Partial<Marker> = {}): Marker => ({
  id,
  time,
  label: text,
  comment: text,
  color: "#f59e0b",
  author: "Ana",
  status: "open",
  createdAt: 1,
  ...extra,
});

const setMarkers = (markers: Marker[]) => {
  const project = createEmptyProject("Comments");
  const executor = new ActionExecutor();
  useProjectStore.setState({
    hasOpenProject: true,
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
    project: { ...project, settings: { ...project.settings, frameRate: 30 }, timeline: { ...project.timeline, markers } },
  });
};

const markers = () => useProjectStore.getState().project.timeline.markers;

describe("CommentsPanel", () => {
  beforeEach(() => useTimelineStore.setState({ playheadPosition: 0 }));
  afterEach(() => {
    cleanup();
    setMarkers([]);
  });

  it("is empty until a comment exists, and ignores plain markers", () => {
    setMarkers([{ id: "m", time: 1, label: "Plain", color: "#fff" }]);
    render(<CommentsPanel />);
    expect(screen.getByTestId("comments-empty")).toBeTruthy();
    expect((screen.getByTestId("comments-export-csv") as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists comments in time order with counts and filters by status", () => {
    setMarkers([comment("b", 9, "Later"), comment("a", 1, "Early"), comment("c", 5, "Done", { status: "resolved" })]);
    render(<CommentsPanel />);
    expect(screen.getAllByTestId("comment-text").map((n) => n.textContent)).toEqual(["Early", "Done", "Later"]);
    expect(screen.getByTestId("comments-count").textContent).toBe("2 open / 1 resolved");
    fireEvent.change(screen.getByTestId("comments-filter"), { target: { value: "resolved" } });
    expect(screen.getAllByTestId("comment-row")).toHaveLength(1);
  });

  it("adds a comment at the playhead", async () => {
    setMarkers([]);
    useTimelineStore.setState({ playheadPosition: 3 });
    render(<CommentsPanel />);
    fireEvent.change(screen.getByTestId("comment-author-input"), { target: { value: "Jo" } });
    fireEvent.change(screen.getByTestId("comment-text-input"), { target: { value: "Check this" } });
    fireEvent.click(screen.getByTestId("comment-add"));
    await waitFor(() => expect(markers()).toHaveLength(1));
    expect(markers()[0]).toMatchObject({ time: 3, author: "Jo", comment: "Check this", status: "open" });
    await waitFor(() => expect(screen.getAllByTestId("comment-row")).toHaveLength(1));
  });

  it("replies and resolves from the card", async () => {
    setMarkers([comment("a", 1, "Fix it")]);
    render(<CommentsPanel />);
    const row = screen.getByTestId("comment-row");
    fireEvent.click(within(row).getByTestId("comment-reply-toggle"));
    fireEvent.change(within(row).getByTestId("comment-reply-input"), { target: { value: "Done" } });
    fireEvent.click(within(row).getByTestId("comment-reply-send"));
    await waitFor(() => expect(markers()[0].replies).toHaveLength(1));
    await waitFor(() => expect(screen.getAllByTestId("comment-reply")).toHaveLength(1));
    fireEvent.click(screen.getByTestId("comment-resolve"));
    await waitFor(() => expect(markers()[0].status).toBe("resolved"));
    expect(screen.getByTestId("comment-row").getAttribute("data-status")).toBe("resolved");
  });

  it("seeks to a comment from its timecode", () => {
    setMarkers([comment("a", 4, "Jump")]);
    render(<CommentsPanel />);
    fireEvent.click(screen.getByTestId("comment-timecode"));
    expect(useTimelineStore.getState().playheadPosition).toBe(4);
  });
});
