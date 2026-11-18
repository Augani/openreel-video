import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectSnippets } from "./ConnectSnippets";

describe("ConnectSnippets without a shim path", () => {
  it("shows a retry state instead of a copyable placeholder command", () => {
    const onRetry = vi.fn();
    render(<ConnectSnippets status={null} onRetry={onRetry} />);
    expect(screen.queryByText(/path to openreel-mcp shim/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("not available yet");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ConnectSnippets tabs", () => {
  const status = { running: true, url: "http://127.0.0.1:1/mcp", port: 1, token: "t", shimPath: "", endpointFile: "" };
  it("keeps the direct HTTP block when there is no shim path", () => {
    render(<ConnectSnippets status={status} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Direct HTTP" }));
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("tabpanel").textContent).toContain("http://127.0.0.1:1/mcp");
  });
  it("shows no retry once a shim path is known", () => {
    render(<ConnectSnippets status={{ ...status, shimPath: "/x/shim.js" }} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByLabelText("Command").textContent).toContain("/x/shim.js");
  });
});
