import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useInterchangeExportPickerStore } from "../../services/timeline-interchange";
import { InterchangeExportDialog } from "./InterchangeExportDialog";

describe("InterchangeExportDialog", () => {
  afterEach(() => {
    cleanup();
    useInterchangeExportPickerStore.getState().setOpen(false);
  });

  it("states that other-NLE round trips are not verified", () => {
    useInterchangeExportPickerStore.getState().setOpen(true);
    render(<InterchangeExportDialog />);
    expect(screen.getByTestId("interchange-verification-note").textContent).toBe(
      "Tested against OpenReel's own importer and spec validators; round-trip in other NLEs not yet verified.",
    );
  });
});
