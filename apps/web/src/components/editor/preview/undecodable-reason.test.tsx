import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreviewFrameStatus } from "../PreviewFrameStatus";
import { describeCodec, undecodableMessage } from "./undecodable-reason";

describe("undecodable video explanation", () => {
  it("names the codecs people actually hit", () => {
    expect(describeCodec("prores_ks")).toBe("ProRes");
    expect(describeCodec("apch")).toBe("ProRes");
    expect(describeCodec("dnxhd")).toBe("DNxHD/DNxHR");
    expect(describeCodec(null, "interview.mov")).toMatch(/ProRes or DNxHD/);
    expect(describeCodec(null)).toBe("this codec");
    expect(describeCodec("mpeg4")).toBe("MPEG4");
  });

  it("tells a web user why and what to do, and does not send a desktop user to the desktop app", () => {
    const web = undecodableMessage("ProRes", false);
    expect(web).toMatch(/This browser cannot decode ProRes/);
    expect(web).toMatch(/preview proxy/);
    expect(web).toMatch(/desktop app/);
    const desktop = undecodableMessage("ProRes", true);
    expect(desktop).not.toMatch(/browser/);
    expect(desktop).toMatch(/on disk/);
  });
});

describe("PreviewFrameStatus", () => {
  it("shows the reason instead of a bare 'Preview unavailable' when one is known", () => {
    render(<PreviewFrameStatus busy={false} failed reason="This browser cannot decode ProRes video." onRetry={() => undefined} />);
    expect(screen.getByTestId("preview-failure-reason").textContent).toBe("This browser cannot decode ProRes video.");
    expect(screen.getByRole("button", { name: "Retry preview" })).toBeTruthy();
  });

  it("keeps the old label when the cause is unknown", () => {
    render(<PreviewFrameStatus busy={false} failed onRetry={() => undefined} />);
    expect(screen.getByTestId("preview-failure-reason").textContent).toBe("Preview unavailable");
  });
});
