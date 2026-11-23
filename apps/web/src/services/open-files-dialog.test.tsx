import "../test/install-local-storage-mock";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { defaultOpenFilesDeps } from "./open-files";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the default which-project question", () => {
  it("is the in-app dialog: window.confirm is never called, Cancel answers no and opens nothing", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const answer = defaultOpenFilesDeps().askWhichProject(2);
    expect(await screen.findByText(/these 2 caption files/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("which-project-cancel"));
    expect(await answer).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
