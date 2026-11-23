import { useProjectStore } from "../stores/project-store";
import { toast } from "../stores/notification-store";

/**
 * Files the operating system opened with OpenReel (double-click, Open With, a second launch with a file on the
 * command line): a project file opens as the project, caption files are imported into the open project. When no
 * project is open the user is asked, in an in-app dialog (which-project-prompt.tsx), which project to import them into. The main process finds and classifies the
 * files (apps/desktop/src/main/open-files.ts); this is the renderer half. Loaded on demand, never at startup.
 */

export interface OpenedFile {
  kind: "project" | "captions";
  path: string;
}

export interface OpenFilesDeps {
  hasOpenProject(): boolean;
  /** Open a project file as the current project. Returns false when it could not be opened (already reported). */
  openProject(path: string): Promise<boolean>;
  /** Ask which project the captions go into: let the user pick one and open it. Returns true when one is open afterwards. */
  askWhichProject(fileCount: number): Promise<boolean>;
  readCaptionFile(path: string): Promise<File>;
  importCaptions(files: File[]): Promise<number>;
  notify(level: "info" | "warning" | "error", title: string, message?: string): void;
}

export interface OpenFilesOutcome {
  opened: string | null;
  imported: number;
  /** Files that were not used, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
}

const baseName = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

/** Caption files are small; refuse anything big enough to be something else. */
export const MAX_CAPTION_FILE_BYTES = 20 * 1024 * 1024;

export async function routeOpenedFiles(items: readonly OpenedFile[], deps: OpenFilesDeps): Promise<OpenFilesOutcome> {
  const outcome: OpenFilesOutcome = { opened: null, imported: 0, skipped: [] };
  const projects = items.filter((item) => item.kind === "project");
  const captions = items.filter((item) => item.kind === "captions");

  // One project at a time: the first one opens, the others are named and left alone.
  if (projects.length) {
    const [first, ...rest] = projects;
    if (await deps.openProject(first.path)) outcome.opened = first.path;
    else outcome.skipped.push({ path: first.path, reason: "The project could not be opened." });
    for (const extra of rest) outcome.skipped.push({ path: extra.path, reason: "Only one project can be open at a time." });
    if (rest.length) deps.notify("info", "Opened one project", `OpenReel opens one project at a time. ${rest.map((p) => baseName(p.path)).join(", ")} ${rest.length === 1 ? "was" : "were"} not opened.`);
    // Captions that came with a project that failed to open are not imported into whatever else is open.
    if (projects.length && !outcome.opened && captions.length) {
      for (const file of captions) outcome.skipped.push({ path: file.path, reason: "The project they came with could not be opened." });
      return outcome;
    }
  }

  if (!captions.length) return outcome;
  if (!deps.hasOpenProject()) {
    // No project to put them in: ask which one.
    if (!(await deps.askWhichProject(captions.length)) || !deps.hasOpenProject()) {
      for (const file of captions) outcome.skipped.push({ path: file.path, reason: "No project was chosen." });
      deps.notify("info", "Captions not imported", "Choose a project to import caption files into.");
      return outcome;
    }
  }

  const files: File[] = [];
  for (const item of captions) {
    try {
      files.push(await deps.readCaptionFile(item.path));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The file could not be read.";
      outcome.skipped.push({ path: item.path, reason });
      deps.notify("error", `Could not read ${baseName(item.path)}`, reason);
    }
  }
  if (files.length) outcome.imported = await deps.importCaptions(files);
  return outcome;
}

/** The real thing: native file reads, the project open flow, the caption importer. */
export function defaultOpenFilesDeps(): OpenFilesDeps {
  return {
    hasOpenProject: () => useProjectStore.getState().hasOpenProject,
    async openProject(path) {
      try {
        const [{ projectManager }, { activateOpenedProject }, { withUserProjectCreation }, { useOnboardingStore }] = await Promise.all([
          import("./project-manager"),
          import("./project-replacement"),
          import("../components/onboarding/shell/project-intent"),
          import("../stores/onboarding-store"),
        ]);
        const content = await window.openreel!.fs.readFile(path);
        const project = await projectManager.parseProjectContent(content);
        await withUserProjectCreation(() => activateOpenedProject({ project, fileHandle: { kind: "native", path } }));
        useOnboardingStore.getState().skip("user");
        window.location.hash = "#/editor";
        return true;
      } catch (error) {
        toast.error(`Could not open ${baseName(path)}`, error instanceof Error ? error.message : undefined);
        return false;
      }
    },
    async askWhichProject(fileCount) {
      const { askWhichProjectInApp } = await import("./which-project-prompt");
      if (!(await askWhichProjectInApp(fileCount))) return false;
      try {
        const [{ openEditorProject }, { withUserProjectCreation }, { useOnboardingStore }] = await Promise.all([
          import("./project-replacement"),
          import("../components/onboarding/shell/project-intent"),
          import("../stores/onboarding-store"),
        ]);
        const opened = await withUserProjectCreation(() => openEditorProject());
        if (opened) {
          useOnboardingStore.getState().skip("user");
          window.location.hash = "#/editor";
        }
        return opened;
      } catch (error) {
        toast.error("Could not open the project", error instanceof Error ? error.message : undefined);
        return false;
      }
    },
    async readCaptionFile(path) {
      const bytes = await window.openreel!.fs.readFileBytes(path);
      if (bytes.byteLength > MAX_CAPTION_FILE_BYTES) throw new Error("The file is too large to be a caption file.");
      return new File([bytes], baseName(path));
    },
    async importCaptions(files) {
      const { importCaptionFiles } = await import("./caption-file-import");
      return importCaptionFiles(files);
    },
    notify: (level, title, message) => toast[level](title, message),
  };
}

/** Deliver files from the main process: one batch at a time, so two opens never interleave. */
let chain: Promise<unknown> = Promise.resolve();
export function handleOpenedFiles(items: readonly OpenedFile[], deps: OpenFilesDeps = defaultOpenFilesDeps()): Promise<OpenFilesOutcome> {
  const run = chain.then(() => routeOpenedFiles(items, deps));
  chain = run.catch(() => undefined);
  return run;
}
