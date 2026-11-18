import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage as ChatMessageData } from "../../../stores/chat-store";
import { ChatMessage } from "./ChatMessage";

const assistantMessage = (text: string): ChatMessageData => ({
  id: "assistant-1",
  role: "assistant",
  text,
  toolCalls: [],
});

describe("ChatMessage", () => {
  const writeText = vi.fn(async () => undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("renders assistant responses as safe GitHub-flavored Markdown", () => {
    const { container } = render(
      <ChatMessage
        message={assistantMessage(
          [
            "## Changes",
            "- Added **title text**",
            "- Used `fade-in`",
            "",
            "| Clip | Result |",
            "| --- | --- |",
            "| Intro | Updated |",
            "",
            "[Open docs](https://example.com/docs)",
            "",
            "<script>window.bad = true</script>",
          ].join("\n"),
        )}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText("title text").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open docs" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "Open docs" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
    expect(container.querySelector("script")).toBeNull();
  });

});
