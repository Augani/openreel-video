import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneProvider } from "./store";
import { SceneTree } from "./SceneTree";

function setup() {
  return render(
    <SceneProvider>
      <SceneTree />
    </SceneProvider>,
  );
}

describe("SceneTree", () => {
  it("shows 'No subjects yet' empty state when scene is empty", () => {
    setup();
    expect(screen.getByText(/No subjects yet/i)).toBeInTheDocument();
  });

  it("clicking '+ Subject' opens the subject picker popover", () => {
    setup();
    const btn = screen.getByRole("button", { name: /\+ Subject/i });
    fireEvent.click(btn);
    expect(screen.getByRole("dialog", { name: /add subject/i })).toBeInTheDocument();
  });

  it("adding a face subject from the picker shows it in the tree", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /\+ Subject/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Face$/ }));
    expect(screen.getByText("Face")).toBeInTheDocument();
  });
});
