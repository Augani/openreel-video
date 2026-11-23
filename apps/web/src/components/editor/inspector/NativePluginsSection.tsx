import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Diamond } from "@/icons/lucide-compat";
import { getNativePluginEffects, nativePluginKeyframeProperty, readNativePluginParams, type Effect, type NativePluginDescriptor, type NativePluginParameter } from "@openreel/core";
import { Button, Progress, cn } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  addNativePluginToClip,
  closeNativePluginWindow,
  describeNativePlugin,
  isNativePluginPreviewBypassed,
  keyframeNativePluginParameter,
  openNativePluginWindow,
  removeNativePluginFromClip,
  scanNativePlugins,
  setNativePluginPreviewBypass,
  unblockNativePlugin,
  updateNativePlugin,
  useNativePluginHost,
  watchNativePluginRenders,
} from "../../../services/native-plugin-host";
import { PropertySlider } from "./shell/PropertySlider";

interface NativePluginsSectionProps {
  clipId: string;
}

const MAX_SHOWN_PARAMS = 12;

const ParameterRow: React.FC<{ clipId: string; effect: Effect; parameter: NativePluginParameter; disabled: boolean }> = ({ clipId, effect, parameter, disabled }) => {
  const stored = readNativePluginParams(effect).values[parameter.key];
  const [draft, setDraft] = useState(stored ?? parameter.value);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const property = nativePluginKeyframeProperty(effect.id, parameter.key);
  const animated = useProjectStore((state) => (state.getClip(clipId)?.keyframes ?? []).some((keyframe) => keyframe.property === property));
  useEffect(() => setDraft(stored ?? parameter.value), [stored, parameter.value]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  const span = parameter.max - parameter.min;
  const step = parameter.indexed ? 1 : span > 0 ? Math.max(span / 1000, 1e-6) : 0.01;
  return (
    <div className="flex items-end gap-1" data-testid={`native-plugin-param-${parameter.key}`}>
      <div className="min-w-0 flex-1">
        <PropertySlider
          label={parameter.name}
          value={draft}
          min={parameter.min}
          max={parameter.max}
          step={step}
          defaultValue={parameter.value}
          isDisabled={disabled}
          formatValue={(value) => `${Number(value.toFixed(3))}${parameter.unitName ? ` ${parameter.unitName}` : ""}`}
          onChange={(value) => {
            setDraft(value);
            if (pending.current) clearTimeout(pending.current);
            pending.current = setTimeout(() => void updateNativePlugin(clipId, effect.id, { values: { [parameter.key]: value } }), 250);
          }}
        />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        type="button"
        disabled={disabled}
        aria-label={`Keyframe ${parameter.name}`}
        aria-pressed={animated}
        data-testid={`native-plugin-keyframe-${parameter.key}`}
        title={animated ? "Animated: add or update a keyframe at the playhead" : "Add a keyframe at the playhead"}
        className="h-6 w-6 shrink-0"
        onClick={() => keyframeNativePluginParameter(clipId, effect.id, parameter.key, draft)}
      >
        <Diamond className={cn("h-3 w-3", animated ? "fill-accent text-accent" : "text-fg-3")} />
      </Button>
    </div>
  );
};

const PluginCard: React.FC<{ clipId: string; effect: Effect; locked: boolean; plugins: readonly NativePluginDescriptor[]; scanned: boolean; hostAvailable: boolean }> = ({ clipId, effect, locked, plugins, scanned, hostAvailable }) => {
  const params = readNativePluginParams(effect);
  const clip = useProjectStore((state) => state.getClip(clipId));
  const known = plugins.find((plugin) => plugin.id === params.pluginId);
  const usable = known?.status === "ok";
  const missing = hostAvailable ? scanned && !usable : true;
  const [parameters, setParameters] = useState<NativePluginParameter[] | null>(null);
  const [latency, setLatency] = useState<number | undefined>(params.latencySamples);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const bypassed = isNativePluginPreviewBypassed(clip, effect.id);

  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    describeNativePlugin(params.pluginId, params.state)
      .then((described) => {
        if (cancelled) return;
        setParameters(described.parameters);
        setLatency(described.latencySamples);
      })
      .catch((cause: unknown) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [usable, params.pluginId, params.state]);

  const shown = useMemo(() => (showAll ? parameters : parameters?.slice(0, MAX_SHOWN_PARAMS)) ?? [], [parameters, showAll]);
  const reason = !hostAvailable ? "Plugin hosting needs the OpenReel desktop app." : (known?.statusReason ?? "This plugin is not installed on this computer.");

  return (
    <div className="space-y-2 rounded-[7px] border border-border bg-bg-1 p-2.5" data-testid={`native-plugin-card-${effect.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium" data-testid="native-plugin-name">{params.name}</p>
          <p className="truncate text-[10px] text-fg-3">{params.vendor || "Unknown vendor"} · {params.format.toUpperCase()}{latency ? ` · latency ${latency} samples (compensated)` : ""}</p>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-fg-3">
          <input
            type="checkbox"
            checked={effect.enabled}
            disabled={locked}
            data-testid="native-plugin-enabled"
            onChange={(event) => void updateNativePlugin(clipId, effect.id, { enabled: event.target.checked })}
          />
          On
        </label>
      </div>
      {missing && effect.enabled && (
        <p className="rounded border border-amber-500/40 px-2 py-1 text-[11px]" role="alert" data-testid="native-plugin-missing">
          Missing: {reason} It plays bypassed; its settings stay in the project.
        </p>
      )}
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
      {usable && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[11px]"
              data-testid="native-plugin-open-window"
              disabled={locked}
              onClick={async () => {
                if (sessionRef.current) void closeNativePluginWindow(sessionRef.current);
                sessionRef.current = await openNativePluginWindow(clipId, effect.id);
              }}
            >
              Open plugin window
            </Button>
            <Button
              size="sm"
              variant={bypassed ? "default" : "outline"}
              className="h-6 text-[11px]"
              data-testid="native-plugin-hear-dry"
              aria-pressed={bypassed}
              onClick={() => setNativePluginPreviewBypass(clipId, effect.id, !bypassed)}
            >
              {bypassed ? "Hearing dry (preview only)" : "Hear dry"}
            </Button>
          </div>
          {shown.map((parameter) => (
            <ParameterRow key={parameter.key} clipId={clipId} effect={effect} parameter={parameter} disabled={locked || !effect.enabled} />
          ))}
          {parameters && parameters.length > MAX_SHOWN_PARAMS && (
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer parameters" : `Show all ${parameters.length} parameters`}
            </Button>
          )}
        </>
      )}
      <Button size="sm" variant="outline" className="w-full text-[11px]" data-testid="native-plugin-remove" disabled={locked} onClick={() => void removeNativePluginFromClip(clipId, effect.id)}>
        Remove plugin
      </Button>
    </div>
  );
};

/**
 * Audio plugins: hosts Audio Units on a clip, out of process (a plugin that crashes costs a helper process, never the editor).
 * The plugin renders the clip's source offline, latency compensated; the preview and the export play the same cached result.
 * Parameters are keyframable through the ordinary clip keyframes, and the plugin's state is saved with the project.
 */
export const NativePluginsSection: React.FC<NativePluginsSectionProps> = ({ clipId }) => {
  const clip = useProjectStore((state) => state.getClip(clipId));
  const locked = useProjectStore((state) => state.project.timeline.tracks.find((track) => track.clips.some((c) => c.id === clipId))?.locked ?? false);
  const host = useNativePluginHost();
  const effects = getNativePluginEffects(clip?.audioEffects);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    watchNativePluginRenders();
    if (host.available && !host.scanned && !host.scanning) void scanNativePlugins();
  }, [host.available, host.scanned, host.scanning]);

  const usable = host.plugins.filter((plugin) => plugin.status === "ok");
  const blocked = host.plugins.filter((plugin) => plugin.status === "blocked");
  const unsupported = host.plugins.filter((plugin) => plugin.status === "unsupported");
  const add = useCallback(async () => {
    const plugin = usable.find((candidate) => candidate.id === choice);
    if (!plugin) return;
    setError(null);
    try {
      await addNativePluginToClip(clipId, plugin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The plugin could not be added.");
    }
  }, [choice, clipId, usable]);

  if (!clip) return null;
  if (!host.available && effects.length === 0) {
    return <p className="text-[11px] leading-relaxed text-fg-3" data-testid="native-plugin-section">Audio plugins (Audio Unit) are available in the OpenReel desktop app.</p>;
  }
  const rendering = host.render.state === "running";

  return (
    <div className="space-y-2.5" data-testid="native-plugin-section">
      {host.available && (
        <>
          <p className="text-[11px] leading-relaxed text-fg-3">
            Audio Units run in a separate helper process. A plugin that crashes or hangs is blocked and never takes the editor down.
          </p>
          <div className="flex gap-1.5">
            <select
              className="h-7 min-w-0 flex-1 rounded-[6px] border border-border bg-bg-1 px-1.5 text-[11px]"
              aria-label="Plugin"
              data-testid="native-plugin-select"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={locked || host.scanning}
            >
              <option value="">{host.scanning ? "Scanning plugins…" : usable.length === 0 ? "No plugins found" : "Choose a plugin…"}</option>
              {usable.map((plugin) => (
                <option key={plugin.id} value={plugin.id}>{plugin.name}{plugin.vendor ? ` (${plugin.vendor})` : ""}</option>
              ))}
            </select>
            <Button size="sm" className="h-7 text-[11px]" data-testid="native-plugin-add" disabled={locked || !choice} onClick={() => void add()}>Add</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" data-testid="native-plugin-rescan" disabled={host.scanning} onClick={() => void scanNativePlugins(true)}>Rescan</Button>
          </div>
          {host.scanning && host.scanProgress && <Progress value={Math.round((host.scanProgress.done / Math.max(1, host.scanProgress.total)) * 100)} className="h-1.5" />}
          {host.helperError && <p className="text-[11px] text-destructive" role="alert" data-testid="native-plugin-helper-error">{host.helperError}</p>}
          {host.scanned && !host.scanning && (
            <p className="text-[10px] text-fg-3" data-testid="native-plugin-scan-summary">
              {usable.length} usable{blocked.length ? ` · ${blocked.length} blocked` : ""}{unsupported.length ? ` · ${unsupported.length} found but not hostable in this build` : ""}
            </p>
          )}
          {blocked.map((plugin) => (
            <div key={plugin.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[10px]" data-testid="native-plugin-blocked">
              <span className="min-w-0 truncate" title={plugin.statusReason}>{plugin.name}: {plugin.statusReason}</span>
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={() => void unblockNativePlugin(plugin.id)}>Unblock</Button>
            </div>
          ))}
        </>
      )}
      {rendering && (
        <div className="space-y-1 rounded-[7px] border border-border bg-bg-1 p-2" role="status" aria-live="polite" data-testid="native-plugin-progress">
          <p className="text-[11px]">Rendering plugins… {Math.round(host.render.fraction * 100)}%</p>
          <Progress value={Math.round(host.render.fraction * 100)} className="h-1.5" />
        </div>
      )}
      {host.render.state === "failed" && (
        <p className="text-[11px] text-destructive" role="alert" data-testid="native-plugin-render-failed">A plugin failed while rendering: {host.render.error}</p>
      )}
      {effects.map((effect) => (
        <PluginCard key={effect.id} clipId={clipId} effect={effect} locked={locked} plugins={host.plugins} scanned={host.scanned} hostAvailable={host.available} />
      ))}
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
    </div>
  );
};
