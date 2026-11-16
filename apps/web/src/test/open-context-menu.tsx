import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu, ContextMenuTrigger } from "@openreel/ui";

export function openContextMenu(content: ReactNode, onBackgroundClick?: () => void) {
  const view = render(<div onClick={onBackgroundClick}><ContextMenu>
    <ContextMenuTrigger asChild><button type="button">Test clip</button></ContextMenuTrigger>
    {content}
  </ContextMenu></div>);
  fireEvent.contextMenu(screen.getByRole("button", { name: "Test clip" }));
  return view;
}
