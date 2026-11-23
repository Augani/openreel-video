import React from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@openreel/ui";
import {
  MAX_OCIO_CONFIG_CHARS,
  MAX_OCIO_FILES,
  MAX_OCIO_FILE_CHARS,
  validateOcioSettings,
  type OcioProjectSettings,
} from "@openreel/core/color/ocio/settings";
import type { OcioInspection } from "@openreel/core/color/ocio/runtime";
import { useProjectStore } from "../../../stores/project-store";
import { inspectOcio } from "../../../services/ocio-inspection";

const LUT_EXTENSIONS = ["cube", "spi1d", "spi3d", "csp"];
const select = "h-7 w-full min-w-0 rounded-[6px] border border-border bg-bg-1 px-2 text-[11px] text-fg";
const label = "text-[10px] font-semibold uppercase tracking-wide text-fg-3";

function relativePath(file: File, stripRoot: boolean): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return file.name;
  const parts = rel.split("/");
  return (stripRoot && parts.length > 1 ? parts.slice(1) : parts).join("/");
}

interface Draft {
  configName: string;
  configText: string;
  files: Record<string, string>;
  /** Files that were provided but cannot be used (and why), so nothing is dropped silently. */
  ignored: string[];
}

/**
 * OCIO setup: load a config and the LUT files it names, see which colour spaces / views / looks the runtime can run (and why
 * the others cannot), pick the working space, the default input space, the display / view and optional looks. Applying is
 * one undoable project settings step; the config text and LUT data are stored in the project.
 */
export const OcioDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const settings = useProjectStore((s) => s.project.settings);
  const updateSettings = useProjectStore((s) => s.updateSettings);
  const stored = settings.ocio;
  const [draft, setDraft] = React.useState<Draft | null>(
    stored ? { configName: stored.configName, configText: stored.configText, files: { ...stored.files }, ignored: [] } : null,
  );
  const [inspection, setInspection] = React.useState<OcioInspection | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [choice, setChoice] = React.useState<{ working: string; input: string; display: string; view: string; looks: string[] }>({
    working: stored?.workingSpace ?? "",
    input: stored?.defaultInputSpace ?? "",
    display: stored?.display ?? "",
    view: stored?.view ?? "",
    looks: [...(stored?.looks ?? [])],
  });
  const [buildError, setBuildError] = React.useState<string | null>(null);

  const readFiles = async (list: readonly File[], base: Draft | null, isFolder: boolean): Promise<void> => {
    if (list.length === 0) return;
    const next: Draft = base ? { ...base, files: { ...base.files }, ignored: [...base.ignored] } : { configName: "", configText: "", files: {}, ignored: [] };
    let total = Object.keys(next.files).length;
    for (const file of list) {
      const ext = (file.name.split(".").pop() ?? "").toLowerCase();
      if (ext === "ocio") {
        if (file.size > MAX_OCIO_CONFIG_CHARS) {
          next.ignored.push(`${file.name} (too large for an OCIO config)`);
          continue;
        }
        // In a folder pick several configs may sit side by side: the first one found (config.ocio first) is used.
        if (!next.configText || !isFolder || file.name.toLowerCase() === "config.ocio") {
          next.configText = await file.text();
          next.configName = file.name;
        }
        continue;
      }
      if (!LUT_EXTENSIONS.includes(ext)) {
        if (!isFolder) next.ignored.push(`${file.name} (the .${ext || "?"} format is not supported)`);
        continue;
      }
      if (file.size > MAX_OCIO_FILE_CHARS) {
        next.ignored.push(`${file.name} (too large)`);
        continue;
      }
      if (total >= MAX_OCIO_FILES) {
        next.ignored.push(`${file.name} (at most ${MAX_OCIO_FILES} LUT files per project)`);
        continue;
      }
      next.files[relativePath(file, isFolder)] = await file.text();
      total++;
    }
    setDraft(next);
  };

  React.useEffect(() => {
    if (!draft || !draft.configText) {
      setInspection(null);
      return;
    }
    let live = true;
    const key = `dialog:${draft.configText.length}:${Object.keys(draft.files).length}:${Object.values(draft.files).reduce((n, t) => n + t.length, 0)}:${draft.configName}`;
    void inspectOcio(draft.configText, draft.files, key).then((result) => {
      if (!live) return;
      if ("error" in result) {
        setInspection(null);
        setError(result.error);
        return;
      }
      setError(null);
      setInspection(result);
      setChoice((current) => {
        const inputOk = (name: string): boolean => result.spaces.some((s) => s.name === name && !s.isData && s.referenceSpaceType === "scene" && !s.problem);
        const workingOk = (name: string): boolean => result.spaces.some((s) => s.name === name && !s.isData && s.referenceSpaceType === "scene" && !s.problem && !s.workingProblem);
        const displayOk = result.displays.find((d) => d.name === current.display);
        const viewOk = displayOk?.views.some((v) => v.name === current.view && !v.problem);
        const fallbackDisplay = result.displays.find((d) => d.name === result.defaults.display);
        return {
          working: workingOk(current.working) ? current.working : result.defaults.workingSpace,
          input: inputOk(current.input) ? current.input : result.defaults.defaultInputSpace,
          display: displayOk ? current.display : (fallbackDisplay?.name ?? result.defaults.display),
          view: displayOk && viewOk ? current.view : displayOk ? (displayOk.views.find((v) => !v.problem)?.name ?? "") : result.defaults.view,
          looks: current.looks.filter((l) => result.looks.some((x) => x.name === l.replace(/^-/, "") && !x.problem)),
        };
      });
    });
    return () => {
      live = false;
    };
  }, [draft]);

  const candidate: OcioProjectSettings | null = React.useMemo(() => {
    if (!draft || !draft.configText || !inspection) return null;
    return {
      configName: draft.configName || "config.ocio",
      configText: draft.configText,
      files: draft.files,
      workingSpace: choice.working,
      defaultInputSpace: choice.input,
      display: choice.display,
      view: choice.view,
      ...(choice.looks.length ? { looks: choice.looks } : {}),
    };
  }, [draft, inspection, choice]);

  // Prove the choice runs before offering Apply: build the compiled transforms now.
  React.useEffect(() => {
    if (!candidate) {
      setBuildError(null);
      return;
    }
    let live = true;
    void import("@openreel/core/color/ocio/runtime").then(({ buildOcioPipeline }) => {
      if (!live) return;
      const problem = validateOcioSettings(candidate);
      if (problem) return setBuildError(problem);
      const result = buildOcioPipeline(candidate);
      setBuildError(result.ok ? null : result.error);
    });
    return () => {
      live = false;
    };
  }, [candidate]);

  const apply = (): void => {
    if (!candidate || buildError) return;
    onClose();
    void updateSettings({ colorManagement: "ocio", ocio: candidate });
  };

  const remove = (): void => {
    onClose();
    void updateSettings({ colorManagement: undefined, ocio: undefined });
  };

  const sceneSpaces = inspection?.spaces.filter((s) => !s.isData && s.referenceSpaceType === "scene" && !s.problem) ?? [];
  const workingSpaces = sceneSpaces.filter((s) => !s.workingProblem);
  const unsupportedSpaces = inspection?.spaces.filter((s) => s.problem) ?? [];
  const display = inspection?.displays.find((d) => d.name === choice.display);
  const unsupportedViews = inspection?.displays.flatMap((d) => d.views.filter((v) => v.problem).map((v) => ({ ...v, display: d.name }))) ?? [];
  const supportedLooks = inspection?.looks.filter((l) => !l.problem) ?? [];
  const unsupportedLooks = inspection?.looks.filter((l) => l.problem) ?? [];

  const toggleLook = (name: string, on: boolean): void =>
    setChoice((c) => ({ ...c, looks: on ? [...c.looks, name] : c.looks.filter((l) => l.replace(/^-/, "") !== name) }));
  const reverseLook = (name: string, reverse: boolean): void =>
    setChoice((c) => ({ ...c, looks: c.looks.map((l) => (l.replace(/^-/, "") === name ? (reverse ? `-${name}` : name) : l)) }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[560px] overflow-y-auto overflow-x-hidden border-border bg-bg-1 text-fg" data-testid="ocio-dialog">
        <DialogHeader>
          <DialogTitle>OpenColorIO configuration</DialogTitle>
          <DialogDescription>
            Load an OCIO config and the LUT files it uses. Footage enters through the colour space you pick, compositing runs in the working
            space, and the picture leaves through the display and view. The config and LUTs are stored in the project.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={label}>Config (.ocio)</span>
              <input
                type="file"
                accept=".ocio"
                data-testid="ocio-config-input"
                className="block w-full text-[11px]"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void readFiles([file], draft ? { ...draft, configText: "", configName: "" } : null, false);
                }}
              />
            </label>
            <label className="space-y-1">
              <span className={label}>LUT files (.cube .spi1d .spi3d .csp)</span>
              <input
                type="file"
                multiple
                accept=".cube,.spi1d,.spi3d,.csp"
                data-testid="ocio-lut-input"
                className="block w-full text-[11px]"
                onChange={(e) => {
                  const input = e.target;
                  void readFiles(Array.from(input.files ?? []), draft, false).then(() => {
                    input.value = "";
                  });
                }}
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className={label}>Or a config folder (config and LUTs together)</span>
              <input
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is not in the React typings
                webkitdirectory=""
                data-testid="ocio-folder-input"
                className="block w-full text-[11px]"
                onChange={(e) => {
                  const input = e.target;
                  void readFiles(Array.from(input.files ?? []), draft, true).then(() => {
                    input.value = "";
                  });
                }}
              />
            </label>
          </div>

          {draft?.configText ? (
            <div className="text-[11px] text-fg-2" data-testid="ocio-loaded">
              Loaded {draft.configName || "config.ocio"} with {Object.keys(draft.files).length} LUT file{Object.keys(draft.files).length === 1 ? "" : "s"}.
            </div>
          ) : (
            <div className="text-[11px] text-fg-3">No config loaded.</div>
          )}
          {error && (
            <div role="alert" className="rounded border border-red-500/40 p-2 text-[11px] text-red-400" data-testid="ocio-error">
              {error}
            </div>
          )}
          {draft && draft.ignored.length > 0 && (
            <div className="text-[10px] text-amber-500" data-testid="ocio-ignored">
              Not used: {draft.ignored.join("; ")}
            </div>
          )}
          {inspection && inspection.missingFiles.length > 0 && (
            <div className="rounded border border-amber-500/40 p-2 text-[11px] text-amber-500" data-testid="ocio-missing">
              LUT files the config names that were not provided: {inspection.missingFiles.join(", ")}. Colour spaces and looks that need them
              are listed as unsupported until you add them.
            </div>
          )}

          {inspection && (
            <>
              <div className="text-[11px] text-fg-2" data-testid="ocio-summary">
                {inspection.name || "OCIO config"} (profile {inspection.version}): {sceneSpaces.length} of {inspection.spaces.filter((s) => !s.isData).length} colour spaces can be read, {workingSpaces.length} used as the working space,{" "}
                {inspection.displays.reduce((n, d) => n + d.views.filter((v) => !v.problem).length, 0)} views and {supportedLooks.length} of {inspection.looks.length} looks can be run.
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={label}>Working space (blending happens here)</span>
                  <select aria-label="OCIO working space" className={select} data-testid="ocio-working-select" value={choice.working} onChange={(e) => setChoice((c) => ({ ...c, working: e.target.value }))}>
                    {workingSpaces.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                        {/scene-linear/i.test(s.encoding) ? "" : " (not scene-linear)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={label}>Default input space (clips and graphics)</span>
                  <select aria-label="OCIO default input space" className={select} data-testid="ocio-input-select" value={choice.input} onChange={(e) => setChoice((c) => ({ ...c, input: e.target.value }))}>
                    {sceneSpaces.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={label}>Display</span>
                  <select
                    aria-label="OCIO display"
                    className={select}
                    data-testid="ocio-display-select"
                    value={choice.display}
                    onChange={(e) => {
                      const d = inspection.displays.find((x) => x.name === e.target.value);
                      setChoice((c) => ({ ...c, display: e.target.value, view: d?.views.find((v) => !v.problem)?.name ?? "" }));
                    }}
                  >
                    {inspection.displays
                      .filter((d) => d.views.some((v) => !v.problem))
                      .map((d) => (
                        <option key={d.name} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={label}>View</span>
                  <select aria-label="OCIO view" className={select} data-testid="ocio-view-select" value={choice.view} onChange={(e) => setChoice((c) => ({ ...c, view: e.target.value }))}>
                    {(display?.views ?? [])
                      .filter((v) => !v.problem)
                      .map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="space-y-1">
                <div className={label}>Looks (applied in the working space, before the view)</div>
                {supportedLooks.length === 0 ? (
                  <div className="text-[11px] text-fg-3">The config has no looks the runtime can run.</div>
                ) : (
                  <ul className="space-y-1" data-testid="ocio-looks">
                    {supportedLooks.map((l) => {
                      const on = choice.looks.find((x) => x.replace(/^-/, "") === l.name);
                      return (
                        <li key={l.name} className="flex items-center gap-2 text-[11px]">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" data-testid={`ocio-look-${l.name}`} checked={!!on} onChange={(e) => toggleLook(l.name, e.target.checked)} />
                            {l.name}
                          </label>
                          <label className="flex items-center gap-1 text-fg-3">
                            <input type="checkbox" disabled={!on} checked={!!on && on.startsWith("-")} onChange={(e) => reverseLook(l.name, e.target.checked)} />
                            reverse
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {(unsupportedSpaces.length > 0 || unsupportedViews.length > 0 || unsupportedLooks.length > 0) && (
                <details className="rounded border border-border p-2" data-testid="ocio-unsupported">
                  <summary className="cursor-pointer text-[11px] text-fg-2">
                    Not supported by the runtime ({unsupportedSpaces.length} colour spaces, {unsupportedViews.length} views, {unsupportedLooks.length} looks)
                  </summary>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-[10px] text-fg-3" data-testid="ocio-unsupported-list">
                    {unsupportedSpaces.map((s) => (
                      <li key={`s-${s.name}`}>
                        <span className="text-fg-2">{s.name}</span>: {s.problem}
                      </li>
                    ))}
                    {unsupportedViews.map((v) => (
                      <li key={`v-${v.display}-${v.name}`}>
                        <span className="text-fg-2">
                          {v.display} / {v.name}
                        </span>
                        : {v.problem}
                      </li>
                    ))}
                    {unsupportedLooks.map((l) => (
                      <li key={`l-${l.name}`}>
                        <span className="text-fg-2">Look {l.name}</span>: {l.problem}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {buildError && (
                <div role="alert" className="rounded border border-red-500/40 p-2 text-[11px] text-red-400" data-testid="ocio-build-error">
                  {buildError}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {stored && (
            <Button variant="ghost" onClick={remove} data-testid="ocio-remove">
              Remove OCIO
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!candidate || !!buildError} data-testid="ocio-apply">
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default OcioDialog;
