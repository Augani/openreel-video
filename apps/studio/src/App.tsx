import { useState, useCallback } from "react";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { Hub, type HubCommands } from "./hub/Hub";
import { EffectEditor, type EffectEditorSeed } from "./effect/EffectEditor";
import { FilterEditor } from "./filter/FilterEditor";
import { TemplateAuthor } from "./components/template/TemplateAuthor";
import { Tutorials } from "./tutorials/Tutorials";
import { TutorialProvider } from "./tutorials/context";
import { CommandsProvider, type AppCommands } from "./commands";
import { resolvePreset } from "./hub/openPreset";
import { loadDraft } from "./hub/drafts";
import { getBehavior } from "./effect/behaviors/registry";
import type { Scene } from "./effect/scene";
import type { FilterDoc } from "./filter/types";

export type View = "hub" | "effect" | "filter" | "template" | "tutorials";

export interface ProjectState {
  name: string;
  kind?: View;
}

export function App() {
  return (
    <TutorialProvider>
      <AppInner />
    </TutorialProvider>
  );
}

function AppInner() {
  const [view, setView] = useState<View>("hub");
  const [project, setProject] = useState<ProjectState>({ name: "Studio" });
  const [effectSeed, setEffectSeed] = useState<EffectEditorSeed | undefined>(undefined);
  const [effectInitial, setEffectInitial] = useState<Scene | undefined>(undefined);
  const [filterInitial, setFilterInitial] = useState<FilterDoc | undefined>(undefined);

  function clearSeeds() {
    setEffectSeed(undefined);
    setEffectInitial(undefined);
    setFilterInitial(undefined);
  }

  const goHome = useCallback(() => {
    setView("hub");
    setProject({ name: "Studio" });
    clearSeeds();
  }, []);

  const newEffect = useCallback(() => {
    clearSeeds();
    setView("effect");
    setProject({ name: "Untitled effect", kind: "effect" });
  }, []);

  const newFilter = useCallback(() => {
    clearSeeds();
    setView("filter");
    setProject({ name: "Untitled filter", kind: "filter" });
  }, []);

  const newTemplate = useCallback(() => {
    clearSeeds();
    setView("template");
    setProject({ name: "Untitled template", kind: "template" });
  }, []);

  const openTutorials = useCallback(() => {
    setView("tutorials");
    setProject({ name: "Tutorials" });
  }, []);

  const openPreset = useCallback((presetId: string) => {
    const intent = resolvePreset(presetId);
    if (!intent) return;
    clearSeeds();
    if (intent.view === "effect") {
      setEffectSeed(intent.initial);
      setView("effect");
      setProject({ name: "Untitled effect", kind: "effect" });
    } else {
      const { behaviorId, behaviorParams } = intent.initial;
      const def = getBehavior(behaviorId);
      if (def) {
        const adj =
          def.kind === "preset"
            ? {
                id: "seed",
                kind: "preset" as const,
                presetId: def.id,
                params: behaviorParams,
                name: def.label,
                visible: true,
              }
            : {
                id: "seed",
                kind: "atomic" as const,
                atomicKind: def.atomicKind!,
                params: behaviorParams,
                name: def.label,
                visible: true,
              };
        setFilterInitial({ name: "Untitled filter", sampleClipId: "portrait-closeup-01", adjustments: [adj] });
      }
      setView("filter");
      setProject({ name: "Untitled filter", kind: "filter" });
    }
  }, []);

  const openRecent = useCallback(async (id: string) => {
    const draft = await loadDraft(id);
    if (!draft) return;
    clearSeeds();
    if (draft.kind === "effect") {
      setEffectInitial(draft.doc as Scene);
      setView("effect");
      setProject({ name: draft.name, kind: "effect" });
    } else if (draft.kind === "filter") {
      setFilterInitial(draft.doc as FilterDoc);
      setView("filter");
      setProject({ name: draft.name, kind: "filter" });
    } else {
      setView("template");
      setProject({ name: draft.name, kind: "template" });
    }
  }, []);

  const hubCommands: HubCommands = { newEffect, newFilter, newTemplate, openPreset, openRecent, openTutorials };
  const appCommands: AppCommands = { goHome, newEffect, newFilter, newTemplate, openPreset, openRecent, openTutorials };

  return (
    <CommandsProvider app={appCommands}>
      <div className="grid h-screen grid-rows-[40px_1fr_22px] bg-zinc-950">
        <TopBar project={project} view={view} onHome={goHome} />
        {view === "hub" && <Hub commands={hubCommands} />}
        {view === "effect" && <EffectEditor initialSeed={effectSeed} initialScene={effectInitial} />}
        {view === "filter" && <FilterEditor initialDoc={filterInitial} />}
        {view === "template" && <TemplateAuthor />}
        {view === "tutorials" && <Tutorials onStart={() => undefined} />}
        <StatusBar view={view} />
      </div>
    </CommandsProvider>
  );
}
