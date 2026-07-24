import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SceneProvider, sceneReducer, initialSceneState } from "./store";
import { Inspector } from "./Inspector";
import { registerAllBehaviors, getBehavior } from "./behaviors/registry";

registerAllBehaviors();

function setupWithSelection() {
  const sparkles = getBehavior("preset.sparkles.face.v1")!;
  let state = sceneReducer(initialSceneState(), { type: "addSubject", kind: "face" });
  const subjectId = state.scene.subjects[0].id;
  state = sceneReducer(state, {
    type: "addBehavior",
    subjectId,
    behavior: {
      id: "b-1",
      kind: "preset",
      presetId: sparkles.id,
      params: { ...sparkles.defaultParams as Record<string, unknown> },
      name: sparkles.label,
      visible: true,
    },
  });
  return render(
    <SceneProvider initial={state}>
      <Inspector />
    </SceneProvider>,
  );
}

describe("Inspector", () => {
  it("empty state when no selection", () => {
    render(
      <SceneProvider>
        <Inspector />
      </SceneProvider>,
    );
    expect(screen.getByText(/Tips/i)).toBeInTheDocument();
  });

  it("renders behavior label and a slider for amount when behavior is selected", () => {
    setupWithSelection();
    expect(screen.getByDisplayValue("Sparkles")).toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });

  it("changing the slider updates the displayed value", () => {
    setupWithSelection();
    const slider = screen.getByLabelText(/amount/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.9" } });
    expect(slider.value).toBe("0.9");
  });
});
