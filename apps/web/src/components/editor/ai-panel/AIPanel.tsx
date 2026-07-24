import type { JSX } from "react";
import { useMemo, useState } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  AI_KINDS,
  AI_KIND_GROUPS,
  kindMatchesClipType,
  isWebSupported,
  type AiKindDef,
  type ClipMediaType,
} from "./ai-kinds.config";
import { AIJobList } from "./AIJobList";
import { PhotoToolsEditor } from "./photo-tools/PhotoToolsEditor";
import { ObjectTrackingEditor } from "./tracking/ObjectTrackingEditor";
import { isGpuAvailable } from "../../../services/gpu-jobs";
import { submitSelectedClipJob } from "../../../services/gpu-clip-submit";

export interface AIPanelProps {
  clipTypeFilter?: ClipMediaType | null;
  embedded?: boolean;
}

export function AIPanel({ clipTypeFilter = null, embedded = false }: AIPanelProps = {}): JSX.Element {
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorKind, setEditorKind] = useState<string | null>(null);

  const visibleKinds: AiKindDef[] = useMemo(
    () =>
      AI_KINDS.filter(
        (k) => isWebSupported(k) && (!clipTypeFilter || kindMatchesClipType(k, clipTypeFilter)),
      ),
    [clipTypeFilter],
  );
  const visibleGroups = useMemo(
    () => AI_KIND_GROUPS.filter((group) => visibleKinds.some((k) => k.group === group)),
    [visibleKinds],
  );

  const runKind = async (kind: string, requiresClip: boolean): Promise<void> => {
    setError(null);
    setBusyKind(kind);
    try {
      const def = AI_KINDS.find((k) => k.kind === kind);
      await submitSelectedClipJob({
        kind,
        requiresClip,
        suggestedName: `${def?.label ?? kind} result`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKind(null);
    }
  };

  if (!isGpuAvailable()) {
    return <div className="p-3 text-[11px] text-text-muted">AI cloud jobs are unavailable in this environment.</div>;
  }

  return (
    <div className={embedded ? "flex flex-col" : "flex h-full flex-col overflow-y-auto"}>
      {error && (
        <div className="m-2 rounded bg-red-900/50 px-3 py-2 text-[10px] text-red-200">{error}</div>
      )}
      {visibleGroups.map((group) => (
        <div key={group} className={embedded ? "py-1.5" : "p-2"}>
          <Text type="label" color="secondary" weight="semibold" className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">{group}</Text>
          <div className="grid grid-cols-2 gap-2">
            {visibleKinds
              .filter((k) => k.group === group)
              .map((k) => (
                <Button
                  key={k.kind}
                  label={busyKind === k.kind ? "Submitting" : k.label}
                  variant="ghost"
                  isDisabled={busyKind !== null}
                  className="rounded bg-background-tertiary px-3 py-2 text-left text-[11px] text-text-primary transition-colors hover:bg-background-secondary disabled:opacity-50"
                  onClick={() =>
                    k.interactive ? setEditorKind(k.kind) : void runKind(k.kind, k.requiresClip)
                  }
                >
                  {busyKind === k.kind ? "Submitting…" : k.label}
                </Button>
              ))}
          </div>
        </div>
      ))}
      <AIJobList />
      {editorKind === "object_removal" && <PhotoToolsEditor onClose={() => setEditorKind(null)} />}
      {editorKind === "object_tracking" && <ObjectTrackingEditor onClose={() => setEditorKind(null)} />}
    </div>
  );
}
