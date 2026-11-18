import "../../../test/install-local-storage-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Describe, { DESCRIBE_PLACEHOLDER } from "./Describe";
import { useSettingsStore } from "../../../stores/settings-store";
import { UNSUPPORTED_PROMISES } from "./starter-prompts";

afterEach(cleanup);

describe("Describe", () => {
  it("has the large prompt box with the spec placeholder", () => {
    render(<Describe connected onSubmit={vi.fn()} />);
    expect(screen.getByPlaceholderText(DESCRIBE_PLACEHOLDER)).toBeInTheDocument();
    expect(DESCRIBE_PLACEHOLDER).toBe("e.g. A 30-second highlight with a title and smooth transitions");
  });

  it("offers exactly the three catalog-honest chips, and none promises unsupported work", () => {
    render(<Describe connected onSubmit={vi.fn()} />);
    const chips = screen.getAllByRole("button").filter((b) => b.closest('[aria-label="Starter prompts"]'));
    expect(chips.map((c) => c.textContent)).toEqual([
      "Cut these into a 30-second highlight with a title and smooth transitions",
      "Make a 9:16 version with a title card",
      "Even out the volume and add fade in and out",
    ]);
    for (const chip of chips) for (const banned of UNSUPPORTED_PROMISES) expect(banned.test(chip.textContent ?? "")).toBe(false);
  });

  it("fills the prompt from a chip and submits it", () => {
    const onSubmit = vi.fn();
    render(<Describe connected onSubmit={onSubmit} />);
    const submit = screen.getByRole("button", { name: "Make my video" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Make a 9:16 version with a title card" }));
    expect(screen.getByRole("textbox")).toHaveValue("Make a 9:16 version with a title card");
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("Make a 9:16 version with a title card");
  });

  it("binds the two switches to the agent settings", () => {
    useSettingsStore.getState().setAgentDryRun(false);
    useSettingsStore.getState().setAgentAutoConfirm(false);
    render(<Describe connected onSubmit={vi.fn()} />);
    const preview = screen.getByRole("switch", { name: "Preview edits before applying" });
    const ask = screen.getByRole("switch", { name: "Ask before deleting anything" });
    expect(preview).toHaveAttribute("aria-checked", "false");
    expect(ask).toHaveAttribute("aria-checked", "true");
    fireEvent.click(preview);
    fireEvent.click(ask);
    expect(useSettingsStore.getState().agentDryRun).toBe(true);
    expect(useSettingsStore.getState().agentAutoConfirm).toBe(true);
  });

  it("without a connected model it opens the editor instead of promising a run", () => {
    const onSubmit = vi.fn();
    render(<Describe connected={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Open the editor" }));
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.getByRole("note")).toHaveTextContent(/No model is connected yet/);
  });
});
