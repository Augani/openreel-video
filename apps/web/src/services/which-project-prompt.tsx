import { createRoot, type Root } from "react-dom/client";
import { WhichProjectDialog } from "../components/editor/WhichProjectDialog";

/**
 * The "which project?" question for caption files opened with no project open: an in-app dialog (it replaces
 * a window.confirm). It mounts its own React root, so nothing of it is in the app's startup code. A second
 * question while one is showing answers the first with "no" and takes its place. Resolves true on
 * "Choose project", false on Cancel, Escape or a click outside.
 */
let current: { root: Root; host: HTMLElement; settle: (chosen: boolean) => void } | null = null;

export function askWhichProjectInApp(fileCount: number): Promise<boolean> {
  current?.settle(false);
  return new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    host.setAttribute("data-which-project-host", "");
    document.body.appendChild(host);
    const root = createRoot(host);
    let done = false;
    const entry = {
      root,
      host,
      settle(chosen: boolean) {
        if (done) return;
        done = true;
        if (current === entry) current = null;
        root.unmount();
        host.remove();
        resolve(chosen);
      },
    };
    current = entry;
    root.render(<WhichProjectDialog fileCount={fileCount} onChoose={() => entry.settle(true)} onCancel={() => entry.settle(false)} />);
  });
}
