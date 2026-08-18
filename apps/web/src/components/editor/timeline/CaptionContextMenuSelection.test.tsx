import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToolcraftContextMenu as ContextMenu } from "@openreel/ui";
import { useUIStore } from "../../../stores/ui-store";

describe("caption context-menu selection", () => {
  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
  });

  it("does not let the menu click clear the selected captions", () => {
    const captionSelection = [
      { id: "caption-a", trackId: "captions", type: "text-clip" as const },
      { id: "caption-b", trackId: "captions", type: "text-clip" as const },
    ];

    render(
      <div onClick={() => useUIStore.getState().clearSelection()}>
        <ContextMenu
          items={[
            {
              label: "Select All Captions",
              onClick: () =>
                useUIStore.getState().selectMultiple(captionSelection),
            },
          ]}
        >
          <button type="button">Caption clip</button>
        </ContextMenu>
      </div>,
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: "Caption clip" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Select All Captions" }),
    );

    expect(useUIStore.getState().selectedItems).toEqual(captionSelection);
  });
});
