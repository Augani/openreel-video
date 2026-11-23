import "../test/install-local-storage-mock";
import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { askWhichProjectInApp } from "./which-project-prompt";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("askWhichProjectInApp", () => {
  it("shows an in-app dialog (not window.confirm) and resolves true on Choose project", async () => {
    let confirmed = false;
    window.confirm = () => ((confirmed = true), true);
    const answer = askWhichProjectInApp(1);
    expect(await screen.findByTestId("which-project-dialog")).toBeTruthy();
    expect(screen.getByText(/this caption file/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("which-project-choose"));
    expect(await answer).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("which-project-dialog")).toBeNull());
    expect(confirmed).toBe(false);
    expect(document.querySelector("[data-which-project-host]")).toBeNull();
  });
  it("names the number of files and resolves false on Cancel", async () => {
    const answer = askWhichProjectInApp(3);
    expect(await screen.findByText(/these 3 caption files/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("which-project-cancel"));
    expect(await answer).toBe(false);
    await waitFor(() => expect(screen.queryByTestId("which-project-dialog")).toBeNull());
  });
  it("resolves false on Escape", async () => {
    const answer = askWhichProjectInApp(2);
    const dialog = await screen.findByTestId("which-project-dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(await answer).toBe(false);
  });
  it("a second question answers the first with no and replaces it", async () => {
    const first = askWhichProjectInApp(1);
    await screen.findByTestId("which-project-dialog");
    const second = askWhichProjectInApp(4);
    expect(await first).toBe(false);
    expect(await screen.findByText(/these 4 caption files/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("which-project-choose"));
    });
    expect(await second).toBe(true);
  });
});
