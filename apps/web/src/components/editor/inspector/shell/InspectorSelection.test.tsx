import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUIStore, type SelectionItem } from "../../../../stores/ui-store";
import { InspectorSelectionProvider, useInspectorSelection } from "./InspectorSelection";

const clipA: SelectionItem = { id: "a", type: "clip" };
const clipB: SelectionItem = { id: "b", type: "clip" };

function Probe({ onRender }: { onRender: (items: SelectionItem[]) => void }) {
  const items = useInspectorSelection();
  onRender(items);
  return null;
}

describe("useInspectorSelection", () => {
  beforeEach(() => {
    act(() => useUIStore.getState().clearSelection());
  });

  it("follows the live selection outside an inspector", () => {
    const seen: string[][] = [];
    render(<Probe onRender={(items) => seen.push(items.map((item) => item.id))} />);
    act(() => useUIStore.getState().select(clipA));
    expect(seen.at(-1)).toEqual(["a"]);
  });

  it("uses the provided selection and does not re-render when the live selection changes", () => {
    let renders = 0;
    const seen: string[][] = [];
    render(
      <InspectorSelectionProvider value={[clipA]}>
        <Probe onRender={(items) => { renders++; seen.push(items.map((item) => item.id)); }} />
      </InspectorSelectionProvider>,
    );
    const before = renders;
    act(() => useUIStore.getState().select(clipB));
    expect(renders).toBe(before);
    expect(seen.at(-1)).toEqual(["a"]);
  });
});
