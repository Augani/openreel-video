import { fireEvent, screen } from "@testing-library/react";

/** Exercise the shared Radix menu, including its actual option activation. */
export async function selectOption(
  trigger: HTMLElement,
  name: string | RegExp,
): Promise<void> {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name }));
}
