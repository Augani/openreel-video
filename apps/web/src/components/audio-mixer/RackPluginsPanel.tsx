import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MASTER_RACK_TARGET, MAX_RACK_NATIVE_PLUGINS, rackIsLive, nativePluginKeyframeProperty, readNativePluginParams, rackPluginEffects, type AudioPluginRack, type Effect, type NativePluginDescriptor, type NativePluginParameter } from "@openreel/core";
import { Button, Progress, cn } from "@openreel/ui";
import { ChevronDown, ChevronUp, Diamond } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import {
  addNativePluginToRack,
  clearRackNativeParameterKeyframes,
  closeNativePluginWindow,
  describeNativePlugin,
  keyframeRackNativeParameter,
  moveRackNativePlugin,
  openRackNativePluginWindow,
  removeRackNativePlugin,
  setRackLivePreview,
  scanNativePlugins,
  unblockNativePlugin,
  updateRackNativePlugin,
  useNativePluginHost,
} from "../../services/native-plugin-host";
import { getPluginRackPreview, usePluginRackPreviewState } from "../../services/plugin-rack-preview";
import { liveInsertsSupported, pushLiveValues, readLiveBlockFrames, retryLiveInsert, useLiveInsertState, writeLiveBlockFrames } from "../../services/live-plugin-insert-state";
import { PropertySlider } from "../editor/inspector/shell/PropertySlider";

/**
 * Hosted audio plugins (Audio Unit today, VST3 behind the same protocol) on a track or a submix bus, like the effect slots of
 * Premiere's Audio Track Mixer. The plugins process the track's / bus's summed signal before its built-in rack: the helper
 * renders that mixdown offline (latency compensated, parameters automated from the rack's keyframes), the result is cached,
 * and the preview and the export play the same buffer. Every edit here is one undoable action.
 */

interface RackPluginsPanelProps {
  /** Track id, bus id or MASTER_RACK_TARGET. */
  target: string;
  label: string;
}

const MAX_SHOWN_PARAMS = 10;

const useRack = (target: string): { rack: AudioPluginRack | undefined; locked: boolean } => {
  const rack = useProjectStore((state) => (target === MASTER_RACK_TARGET ? state.project.timeline.masterPluginRack : (state.project.timeline.tracks.find((t) => t.id === target)?.pluginRack ?? state.project.timeline.audioBuses?.find((b) => b.id === target)?.pluginRack)));
  const locked = useProjectStore((state) => state.project.timeline.tracks.find((t) => t.id === target)?.locked ?? false);
  return { rack, locked };
};

const ParameterRow = ({ target, rack, effect, parameter, disabled }: { target: string; rack: AudioPluginRack; effect: Effect; parameter: NativePluginParameter; disabled: boolean }) => {
  const stored = readNativePluginParams(effect).values[parameter.key];
  const [draft, setDraft] = useState(stored ?? parameter.value);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const property = nativePluginKeyframeProperty(effect.id, parameter.key);
  const animated = (rack.keyframes ?? []).some((keyframe) => keyframe.property === property);
  useEffect(() => setDraft(stored ?? parameter.value), [stored, parameter.value]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  const span = parameter.max - parameter.min;
  const step = parameter.indexed ? 1 : span > 0 ? Math.max(span / 1000, 1e-6) : 0.01;
  return (
    <div className="flex items-end gap-1" data-testid={`rack-plugin-param-${parameter.key}`}>
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
            pushLiveValues(target, effect.id, { [parameter.key]: value });
            if (pending.current) clearTimeout(pending.current);
            pending.current = setTimeout(() => void updateRackNativePlugin(target, effect.id, { values: { [parameter.key]: value } }), 250);
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
        data-testid={`rack-plugin-keyframe-${parameter.key}`}
        title={animated ? "Animated: add or update a keyframe at the playhead" : "Add a keyframe at the playhead"}
        className="h-6 w-6 shrink-0"
        onClick={() => void keyframeRackNativeParameter(target, effect.id, parameter.key, draft)}
      >
        <Diamond className={cn("h-3 w-3", animated ? "fill-accent text-accent" : "text-fg-3")} />
      </Button>
      {animated && (
        <Button variant="ghost" size="sm" type="button" disabled={disabled} className="h-6 px-1 text-[10px]" aria-label={`Clear ${parameter.name} keyframes`} onClick={() => void clearRackNativeParameterKeyframes(target, effect.id, parameter.key)}>
          Clear
        </Button>
      )}
    </div>
  );
};

const PluginCard = ({ target, rack, effect, index, count, locked, plugins, scanned, hostAvailable, bypassReason }: {
  target: string;
  rack: AudioPluginRack;
  effect: Effect;
  index: number;
  count: number;
  locked: boolean;
  plugins: readonly NativePluginDescriptor[];
  scanned: boolean;
  hostAvailable: boolean;
  bypassReason: string | undefined;
}) => {
  const params = readNativePluginParams(effect);
  const known = plugins.find((plugin) => plugin.id === params.pluginId);
  const usable = known?.status === "ok";
  const missing = hostAvailable ? scanned && !usable : true;
  const [parameters, setParameters] = useState<NativePluginParameter[] | null>(null);
  const [latency, setLatency] = useState<number | undefined>(params.latencySamples);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState(() => getPluginRackPreview().isPreviewBypassed(effect.id));
  const sessionRef = useRef<string | null>(null);

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
    <div className="space-y-2 rounded-[7px] border border-border bg-bg-1 p-2" data-testid={`rack-plugin-card-${effect.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium" data-testid="rack-plugin-name">{params.name}</p>
          <p className="truncate text-[10px] text-fg-3">{params.vendor || "Unknown vendor"} · {params.format.toUpperCase()}{latency ? ` · latency ${latency} samples (compensated)` : ""}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" className="size-5" aria-label={`Move ${params.name} earlier`} disabled={locked || index === 0} onClick={() => void moveRackNativePlugin(target, effect.id, index - 1)}>
            <ChevronUp size={11} aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="size-5" aria-label={`Move ${params.name} later`} disabled={locked || index === count - 1} onClick={() => void moveRackNativePlugin(target, effect.id, index + 1)}>
            <ChevronDown size={11} aria-hidden />
          </Button>
          <label className="ml-1 flex items-center gap-1 text-[10px] text-fg-3">
            <input type="checkbox" checked={effect.enabled} disabled={locked} data-testid="rack-plugin-enabled" onChange={(event) => void updateRackNativePlugin(target, effect.id, { enabled: event.target.checked })} />
            On
          </label>
        </div>
      </div>
      {((missing && effect.enabled) || bypassReason) && (
        <p className="rounded border border-amber-500/40 px-2 py-1 text-[11px]" role="alert" data-testid="rack-plugin-missing">
          Bypassed: {bypassReason ?? reason} Its settings stay in the project.
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
              data-testid="rack-plugin-open-window"
              disabled={locked}
              onClick={async () => {
                if (sessionRef.current) void closeNativePluginWindow(sessionRef.current);
                sessionRef.current = await openRackNativePluginWindow(target, effect.id);
              }}
            >
              Open plugin window
            </Button>
            <Button
              size="sm"
              variant={dry ? "default" : "outline"}
              className="h-6 text-[11px]"
              data-testid="rack-plugin-hear-dry"
              aria-pressed={dry}
              onClick={() => {
                getPluginRackPreview().setPreviewBypass(effect.id, !dry);
                setDry(!dry);
              }}
            >
              {dry ? "Hearing dry (preview only)" : "Hear dry"}
            </Button>
          </div>
          {shown.map((parameter) => (
            <ParameterRow key={parameter.key} target={target} rack={rack} effect={effect} parameter={parameter} disabled={locked || !effect.enabled} />
          ))}
          {parameters && parameters.length > MAX_SHOWN_PARAMS && (
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Show fewer parameters" : `Show all ${parameters.length} parameters`}
            </Button>
          )}
        </>
      )}
      <Button size="sm" variant="outline" className="w-full text-[11px]" data-testid="rack-plugin-remove" disabled={locked} onClick={() => void removeRackNativePlugin(target, effect.id)}>
        Remove plugin
      </Button>
    </div>
  );
};

/**
 * Live preview switch for one rack (desktop). Live: the plugins stream block by block while the preview plays, so an edit is heard at once;
 * Rendered: the preview plays the cached offline render. The export is always the offline render either way.
 */
const LivePreviewControl = ({ target, rack, locked }: { target: string; rack: AudioPluginRack; locked: boolean }) => {
  const status = useLiveInsertState((state) => Object.entries(state.targets).find(([key]) => key.endsWith(`:${target}`))?.[1]);
  const live = rackIsLive(rack);
  const [blockFrames, setBlockFrames] = useState<number>(() => readLiveBlockFrames());
  if (!liveInsertsSupported()) return null;
  return (
    <div className="space-y-1 rounded-[7px] border border-border bg-bg-1 p-2" data-testid="rack-live-preview">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-medium">
          <input type="checkbox" checked={live} disabled={locked} data-testid="rack-live-toggle" onChange={(event) => void setRackLivePreview(target, event.target.checked)} />
          Live preview
        </label>
        {live && (
          <select
            className="h-6 rounded-[6px] border border-border bg-bg-1 px-1 text-[10px]"
            aria-label="Live block size"
            data-testid="rack-live-block-size"
            value={blockFrames}
            onChange={(event) => {
              const next = Number(event.target.value) as 128 | 256 | 512;
              setBlockFrames(next);
              writeLiveBlockFrames(next);
            }}
          >
            <option value={128}>128 frames (lowest latency)</option>
            <option value={256}>256 frames</option>
            <option value={512}>512 frames (safest)</option>
          </select>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-fg-3" role="status" aria-live="polite" data-testid="rack-live-status">
        {!live
          ? "Rendered: the preview plays a cached render, so a change is heard after it re-renders. The export is always rendered."
          : !status || status.phase === "opening"
            ? "Opening live insert…"
            : status.phase === "live"
              ? `Live: ${status.latencyMs.toFixed(1)} ms latency, compensated on every other track. ${status.underruns === 0 ? "No dropouts." : `${status.underruns} dropout${status.underruns === 1 ? "" : "s"} (played dry, crossfaded).`}`
              : `${status.phase === "unavailable" ? "Not live" : "Live insert stopped"}: ${status.reason ?? "the plugin host is not available"}. The rendered version plays instead.`}
      </p>
      {live && status && status.phase === "failed" && (
        <Button size="sm" variant="outline" className="h-6 text-[11px]" data-testid="rack-live-retry" onClick={() => retryLiveInsert(target)}>Retry live</Button>
      )}
    </div>
  );
};

export default function RackPluginsPanel({ target, label }: RackPluginsPanelProps) {
  const { rack, locked } = useRack(target);
  const host = useNativePluginHost();
  const preview = usePluginRackPreviewState();
  const effects = rackPluginEffects(rack);
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (host.available && !host.scanned && !host.scanning) void scanNativePlugins();
  }, [host.available, host.scanned, host.scanning]);

  const usable = host.plugins.filter((plugin) => plugin.status === "ok");
  const blocked = host.plugins.filter((plugin) => plugin.status === "blocked");
  const full = effects.length >= MAX_RACK_NATIVE_PLUGINS;
  const add = useCallback(async () => {
    const plugin = usable.find((candidate) => candidate.id === choice);
    if (!plugin) return;
    setError(null);
    try {
      await addNativePluginToRack(target, plugin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The plugin could not be added.");
    }
  }, [choice, target, usable]);

  if (!host.available && effects.length === 0) {
    return <p className="text-[11px] leading-relaxed text-fg-3" data-testid="rack-plugins-panel">Audio plugins (Audio Unit) are available in the OpenReel desktop app.</p>;
  }
  const bypassed = preview.bypassed[target] ?? {};

  return (
    <div className="space-y-2.5" data-testid="rack-plugins-panel" aria-label={`${label} audio plugins`}>
      <p className="text-[11px] leading-relaxed text-fg-3">
        {target === MASTER_RACK_TARGET
          ? "Plugins process the whole mix (every track and bus) before the master fader and effects, and before any export loudness normalisation or true-peak limiting. They run"
          : "Plugins process this track or bus as a whole, before its effects, fader and pan. They run"} in a separate helper process; a plugin that crashes is blocked and never takes the editor down.
      </p>
      {host.available && (
        <>
          <div className="flex gap-1.5">
            <select
              className="h-7 min-w-0 flex-1 rounded-[6px] border border-border bg-bg-1 px-1.5 text-[11px]"
              aria-label="Plugin"
              data-testid="rack-plugin-select"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              disabled={locked || host.scanning || full}
            >
              <option value="">{host.scanning ? "Scanning plugins…" : usable.length === 0 ? "No plugins found" : full ? "Rack is full" : "Choose a plugin…"}</option>
              {usable.map((plugin) => (
                <option key={plugin.id} value={plugin.id}>{plugin.name}{plugin.vendor ? ` (${plugin.vendor})` : ""}</option>
              ))}
            </select>
            <Button size="sm" className="h-7 text-[11px]" data-testid="rack-plugin-add" disabled={locked || full || !choice} onClick={() => void add()}>Add</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={host.scanning} onClick={() => void scanNativePlugins(true)}>Rescan</Button>
          </div>
          {host.scanning && host.scanProgress && <Progress value={Math.round((host.scanProgress.done / Math.max(1, host.scanProgress.total)) * 100)} className="h-1.5" />}
          {host.helperError && <p className="text-[11px] text-destructive" role="alert">{host.helperError}</p>}
          {blocked.map((plugin) => (
            <div key={plugin.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[10px]">
              <span className="min-w-0 truncate" title={plugin.statusReason}>{plugin.name}: {plugin.statusReason}</span>
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[10px]" onClick={() => void unblockNativePlugin(plugin.id)}>Unblock</Button>
            </div>
          ))}
        </>
      )}
      {rack && effects.length > 0 && <LivePreviewControl target={target} rack={rack} locked={locked} />}
      {preview.status === "rendering" && !(rack && effects.length > 0 && rackIsLive(rack) && liveInsertsSupported()) && (
        <p className="rounded-[7px] border border-border bg-bg-1 p-2 text-[11px]" role="status" aria-live="polite" data-testid="rack-plugin-rendering">Rendering plugins… playback is dry until it is ready.</p>
      )}
      {preview.status === "failed" && (
        <p className="text-[11px] text-destructive" role="alert" data-testid="rack-plugin-render-failed">A plugin failed while rendering: {preview.error}</p>
      )}
      {rack && effects.map((effect, index) => (
        <PluginCard key={effect.id} target={target} rack={rack} effect={effect} index={index} count={effects.length} locked={locked} plugins={host.plugins} scanned={host.scanned} hostAvailable={host.available} bypassReason={bypassed[effect.id]} />
      ))}
      {error && <p className="text-[11px] text-destructive" role="alert">{error}</p>}
    </div>
  );
}
