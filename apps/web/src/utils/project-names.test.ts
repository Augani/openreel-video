import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateProjectName,
  generateSimpleProjectName,
} from "./project-names";

describe("project name generation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the first adjective and city when random selects the lower bound", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    expect(generateProjectName()).toBe("Morning Tokyo");
    expect(generateSimpleProjectName()).toBe("Tokyo");
  });

  it("uses the last adjective and city when random selects the upper bound", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);

    expect(generateProjectName()).toBe("Mystic Taipei");
    expect(generateSimpleProjectName()).toBe("Taipei");
  });

  it("combines one adjective and one city for full project names", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.5);

    const parts = generateProjectName().split(" ");

    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe("Crystal");
    expect(parts[1]).toBe("Cairo");
  });
});
