import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GraphicsEngine, TitleEngine, type Track } from "@openreel/core";
import { initLanguage, languageStore } from "@openreel/i18n";
import { GraphicsClipContextMenu } from "./GraphicsClipContextMenu";
import { TrackHeader } from "./TrackHeader";
import { openContextMenu } from "../../../test/open-context-menu";
import { useEngineStore } from "../../../stores/engine-store";
import { useProjectStore } from "../../../stores/project-store";
import { createEmptyProject } from "../../../stores/project/project-helpers";

const noop = () => undefined;

afterEach(() => {
  localStorage.removeItem("openreel.language");
  cleanup();
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
});

it("translates clip menu actions but not the clip/track name", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  useEngineStore.setState({ titleEngine: new TitleEngine(), graphicsEngine: new GraphicsEngine() });
  languageStore.setPreference("zh-CN");
  useProjectStore.getState().createNewProject("i18n");
  const state = useProjectStore.getState();
  const track = state.project.timeline.tracks[0];
  const clip = state.createTextClip(track.id, 0, "Keep", 2)!;

  openContextMenu(<GraphicsClipContextMenu clip={clip} clipType="text" />);

  expect(await screen.findByRole("menuitem", { name: "创建副本" })).toBeInTheDocument();
  expect(await screen.findByRole("menuitem", { name: "删除" })).toBeInTheDocument();
});

it("preserves a user-provided track name inside a translated menu action", async () => {
  initLanguage({ storage: localStorage, systemLanguages: ["en-US"] });
  languageStore.setPreference("zh-CN");
  const project = createEmptyProject("i18n");
  const track: Track = {
    id: "track-file",
    type: "audio",
    name: "File",
    clips: [],
    transitions: [],
    locked: false,
    hidden: false,
    muted: false,
    solo: false,
  };
  useProjectStore.setState({
    hasOpenProject: true,
    project: { ...project, timeline: { ...project.timeline, tracks: [track] } },
  });

  const view = render(
    <TrackHeader
      track={track}
      index={0}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
    />,
  );
  fireEvent.contextMenu(view.container.querySelector("[data-timeline-track-header]")!);

  expect(await screen.findByRole("menuitemcheckbox", { name: "静音 File" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitemcheckbox", { name: "静音" })).toBeNull();
  expect(screen.queryByText("静音", { exact: true })).toBeNull();
});
