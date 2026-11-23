import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransitionHandle } from "./TransitionHandle";
import type { ResolvedTransitionHandle } from "./transition-handles";

const handle = {
  centerX: 120,
  transition: undefined,
  clipA: "a",
  clipB: "b",
  edge: undefined,
} as unknown as ResolvedTransitionHandle;

const mount = () => render(<TransitionHandle handle={handle} trackId="t" isSelected={false} onSelect={vi.fn()} />);
const button = () => screen.getByRole("button");

describe("TransitionHandle lazy dropdown", () => {
  afterEach(cleanup);

  it("stays a single button when hover arms the menu", () => {
    mount();
    const before = button();
    fireEvent.pointerEnter(before);
    // Hover alone may remount the badge; the plain button must still be the only one and usable.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps keyboard focus after focus arms it", () => {
    mount();
    act(() => button().focus());
    expect(document.activeElement).toBe(button());
  });

  it("opens the menu with Enter from keyboard focus", async () => {
    mount();
    act(() => button().focus());
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(await screen.findByRole("menu")).toBeTruthy();
  });

  it("opens on right click without hover", async () => {
    mount();
    fireEvent.contextMenu(button());
    expect(await screen.findByRole("menu")).toBeTruthy();
  });
});
