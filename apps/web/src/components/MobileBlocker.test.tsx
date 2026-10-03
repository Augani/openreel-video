import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileBlocker, supportsBrowserEditing } from "./MobileBlocker";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("browser editing capability gate", () => {
  it("allows capable phones and tablets regardless of their user agent", () => {
    vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(); });
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("iPhone Mobile Safari");
    expect(supportsBrowserEditing()).toBe(true);
    expect(render(<MobileBlocker />).queryByRole("alert")).toBeNull();
  });
  it("explains an actual missing canvas API", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const view = render(<MobileBlocker />);
    expect(supportsBrowserEditing()).toBe(false);
    expect(view.getByRole("alert")).toHaveTextContent("Your browser needs an update");
  });
});
