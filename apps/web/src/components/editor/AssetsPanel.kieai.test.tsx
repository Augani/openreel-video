import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor, type MediaItem } from "@openreel/core";
import { AssetsPanel } from "./AssetsPanel";
import { useProjectStore } from "../../stores/project-store";
import { useEditorWorkspaceStore } from "../../stores/editor-workspace-store";
import { useUIStore } from "../../stores/ui-store";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { loadMediaBlob } from "../../services/media-storage";
vi.mock("../../services/media-storage", async (original) => ({
  ...(await original<typeof import("../../services/media-storage")>()),
  loadMediaBlob: vi.fn(),
}));
vi.mock("./kieai/KieAIImageDialog", () => ({
  KieAIImageDialog: ({
    open,
    sourceFile,
  }: {
    open: boolean;
    sourceFile: File;
  }) =>
    open ? (
      <div role="dialog" aria-label="Provider source">
        {sourceFile.name}
      </div>
    ) : null,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const media = (id: string): MediaItem => ({
  id,
  name: `${id}.png`,
  type: "image",
  fileHandle: null,
  blob: new Blob([id], { type: "image/png" }),
  metadata: {
    duration: 0,
    width: 32,
    height: 32,
    frameRate: 0,
    codec: "",
    sampleRate: 0,
    channels: 0,
    fileSize: 1,
  },
  thumbnailUrl: null,
  waveformData: null,
});
function project(items: MediaItem[]) {
  const executor = new ActionExecutor();
  useProjectStore.setState({
    hasOpenProject: true,
    project: { ...createEmptyProject("Sources"), mediaLibrary: { items } },
    actionExecutor: executor,
    actionHistory: executor.getHistory(),
  });
}
beforeEach(() => {
  vi.mocked(loadMediaBlob).mockReset();
  project([media("A"), media("B")]);
  useEditorWorkspaceStore.getState().setSection("media");
  useUIStore.getState().clearSelection();
});
afterEach(cleanup);
async function open(name: string) {
  fireEvent.keyDown(
    screen.getByRole("button", { name: `Media actions for ${name}.png` }),
    { key: "ArrowDown" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Create with KieAI" }),
  );
}
describe("image source loading ownership", () => {
  it("does not open the old source after changing projects", async () => {
    const pending = deferred<Blob>();
    vi.mocked(loadMediaBlob).mockReturnValueOnce(pending.promise);
    render(<AssetsPanel />);
    await open("A");
    act(() => project([]));
    await act(async () =>
      pending.resolve(new Blob(["A"], { type: "image/png" })),
    );
    expect(
      screen.queryByRole("dialog", { name: "Provider source" }),
    ).not.toBeInTheDocument();
  });
  it("keeps the latest requested source when earlier reads resolve later", async () => {
    const pending = deferred<Blob>();
    vi.mocked(loadMediaBlob)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(new Blob(["B"], { type: "image/png" }));
    render(<AssetsPanel />);
    await open("A");
    await open("B");
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "Provider source" }),
      ).toHaveTextContent("B.png"),
    );
    await act(async () =>
      pending.resolve(new Blob(["A"], { type: "image/png" })),
    );
    expect(
      screen.getByRole("dialog", { name: "Provider source" }),
    ).toHaveTextContent("B.png");
  });
  it("ignores a source whose panel unmounted", async () => {
    const pending = deferred<Blob>();
    vi.mocked(loadMediaBlob).mockReturnValueOnce(pending.promise);
    const view = render(<AssetsPanel />);
    await open("A");
    view.unmount();
    await act(async () =>
      pending.resolve(new Blob(["A"], { type: "image/png" })),
    );
    expect(
      screen.queryByRole("dialog", { name: "Provider source" }),
    ).not.toBeInTheDocument();
  });
});

it("does not open bytes from a source that was relinked during its read", async () => {
  const pending = deferred<Blob>();
  vi.mocked(loadMediaBlob).mockReturnValueOnce(pending.promise);
  render(<AssetsPanel />);
  await open("A");
  act(() => {
    const state = useProjectStore.getState();
    useProjectStore.setState({
      project: {
        ...state.project,
        mediaLibrary: {
          items: state.project.mediaLibrary.items.map((item) =>
            item.id === "A"
              ? { ...item, blob: new Blob(["new"], { type: "image/png" }) }
              : item,
          ),
        },
      },
    });
  });
  await act(async () =>
    pending.resolve(new Blob(["old"], { type: "image/png" })),
  );
  expect(
    screen.queryByRole("dialog", { name: "Provider source" }),
  ).not.toBeInTheDocument();
});
