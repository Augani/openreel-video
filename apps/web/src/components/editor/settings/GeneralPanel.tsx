import { useCallback, useEffect, useId, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button, Card, Checkbox, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, ToggleGroup, ToggleGroupItem, cn } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type TtsProvider, type LlmProvider, type AggregatorProvider } from "../../../stores/settings-store";
import { useProjectStore } from "../../../stores/project-store";
import { CHANNEL_PRESETS, CHANNEL_PRESET_LABELS, type ChannelPreset } from "@openreel/core";
import { EDITING_FRAME_RATE_OPTIONS } from "../editing-frame-rate";
import { AudioOutputSelect } from "./AudioOutputSelect";

const ASPECT_PRESETS = [
  { label: "16:9 Landscape (1080p)", width: 1920, height: 1080 },
  { label: "9:16 Vertical (TikTok/Reels)", width: 1080, height: 1920 },
  { label: "1:1 Square", width: 1080, height: 1080 },
  { label: "4:5 Portrait", width: 1080, height: 1350 },
  { label: "4:3 Standard", width: 1440, height: 1080 },
  { label: "21:9 Cinematic", width: 2560, height: 1080 },
  { label: "4K Landscape", width: 3840, height: 2160 },
];
const BACKGROUND_SWATCHES = ["#000000", "#FFFFFF", "#1E1E1E", "#2563EB", "#DC2626", "#16A34A", "#F59E0B", "#9333EA", "#DB2777", "#0EA5E9"];
const controlClass = "h-8 min-w-0 rounded-md bg-bg-2 px-2 text-xs md:text-xs";

function PreferenceSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) {
  const choices = value && !options.some(option => option.value === value) ? [{ value, label: value }, ...options] : options;
  return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className={cn(controlClass, "w-full sm:w-[180px]")}><SelectValue /></SelectTrigger><SelectContent>{choices.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>;
}
function PreferenceText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = useId();
  return <div className="space-y-1.5"><Label htmlFor={id} className="text-xs text-fg-2">{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} className={controlClass} /></div>;
}

export function GeneralPanel() {
  const preferences = useSettingsStore(useShallow(state => ({ autoSave: state.autoSave, autoSaveInterval: state.autoSaveInterval,
    defaultTtsProvider: state.defaultTtsProvider, defaultLlmProvider: state.defaultLlmProvider, llmBaseUrl: state.llmBaseUrl,
    llmModel: state.llmModel, defaultAggregator: state.defaultAggregator, defaultAudioChannels: state.defaultAudioChannels, configuredServices: state.configuredServices })));
  const project = useProjectStore(state => state.project.settings);
  const projectId = useProjectStore(state => state.project.id);
  const backgroundFillMode = useProjectStore(state => state.project.timeline.backgroundFillMode);
  const backgroundColor = useProjectStore(state => state.project.timeline.layoutBackgroundColor);
  const updateProjectSettings = useProjectStore(state => state.updateSettings);
  const setCanvasBackground = useProjectStore(state => state.setCanvasBackground);
  const [draftWidth, setDraftWidth] = useState(String(project.width));
  const [draftHeight, setDraftHeight] = useState(String(project.height));
  const [scaleGraphics, setScaleGraphics] = useState(true);
  const widthId = useId(), heightId = useId(), autoSaveId = useId();
  useEffect(() => { setDraftWidth(String(project.width)); setDraftHeight(String(project.height)); }, [projectId, project.width, project.height]);
  const applyDimensions = useCallback(async (width: number, height: number) => {
    if (![width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
    await updateProjectSettings({ width: Math.max(16, Math.min(7680, Math.round(width))), height: Math.max(16, Math.min(7680, Math.round(height))) }, { scaleGraphics });
  }, [updateProjectSettings, scaleGraphics]);
  const llmProviders = SERVICE_REGISTRY.filter(service => service.id === "openai-compatible" || service.id === "anthropic-compatible");
  const aggregatorProviders = SERVICE_REGISTRY.filter(service => service.id === "kie-ai" || service.id === "freepik" || preferences.configuredServices.includes(service.id));
  return <div className="space-y-5 pb-1 text-xs">
    <section className="space-y-3" aria-labelledby="composition-settings-heading">
      <div><h3 id="composition-settings-heading" className="text-sm font-medium">Project Composition</h3><p className="mt-1 text-xs leading-5 text-fg-2">Set the canvas dimensions for your project. Pick a preset for TikTok, Reels, YouTube, or enter custom values.</p></div>
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {ASPECT_PRESETS.map(preset => <Button key={preset.label} variant="outline" aria-label={preset.label} aria-pressed={preset.width === project.width && preset.height === project.height} onClick={() => { void applyDimensions(preset.width, preset.height); }} className="h-auto min-w-0 flex-col items-start whitespace-normal rounded-md p-3 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10"><span>{preset.label}</span><span className="font-normal text-fg-2">{preset.width} × {preset.height}</span></Button>)}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
        <div className="space-y-1.5"><Label htmlFor={widthId} className="text-xs text-fg-2">Width</Label><Input id={widthId} type="number" min={16} max={7680} step={1} inputMode="numeric" value={draftWidth} onChange={event => setDraftWidth(event.target.value)} className={controlClass} /></div>
        <div className="space-y-1.5"><Label htmlFor={heightId} className="text-xs text-fg-2">Height</Label><Input id={heightId} type="number" min={16} max={7680} step={1} inputMode="numeric" value={draftHeight} onChange={event => setDraftHeight(event.target.value)} className={controlClass} /></div>
        <Button type="button" onClick={() => { void applyDimensions(Number(draftWidth), Number(draftHeight)); }} className="h-8 text-xs">Apply</Button>
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] leading-4 text-fg-2"><Checkbox checked={scaleGraphics} aria-label="Scale graphics to new frame size" onCheckedChange={value => setScaleGraphics(value === true)} className="mt-px" /><span>Scale graphics to new frame size: titles, text, shapes and templates keep their proportion to the frame (one undo step).</span></label>
      <Card className="flex flex-col justify-between gap-3 rounded-md bg-bg-2 p-3 shadow-none sm:flex-row sm:items-center"><div className="min-w-0"><h4 className="text-xs font-medium">Editing frame rate</h4><p className="mt-1 text-[11px] leading-4 text-fg-2">Controls preview playback, frame stepping, and the default export rate. Existing clip timing stays unchanged.</p></div>
        <PreferenceSelect label="Editing frame rate" value={String(project.frameRate)} options={EDITING_FRAME_RATE_OPTIONS.map(option => ({ label: option.label, value: String(option.value) }))} onChange={value => { const frameRate = Number(value); if (Number.isFinite(frameRate) && frameRate > 0) void updateProjectSettings({ frameRate }); }} />
      </Card>
      <div className="space-y-2"><h4 className="text-xs font-medium text-fg-2">Background fill</h4><p className="text-[11px] leading-4 text-fg-2">Fills the canvas around clips that don&apos;t match the aspect ratio.</p>
        <div className="flex flex-wrap items-center gap-2"><ToggleGroup type="single" value={backgroundFillMode === "blur" ? "blur" : backgroundFillMode === "color" ? "color" : "none"} onValueChange={value => { if (value === "none") setCanvasBackground(undefined, undefined); if (value === "blur") setCanvasBackground("blur", backgroundColor); }} aria-label="Background fill">
          <ToggleGroupItem value="none" aria-label="No background fill" className="h-8 text-xs">None</ToggleGroupItem><ToggleGroupItem value="blur" aria-label="Blur background fill" className="h-8 text-xs">Blur</ToggleGroupItem>
        </ToggleGroup>
        {BACKGROUND_SWATCHES.map(hex => <Button key={hex} type="button" variant="ghost" aria-label={`Background color ${hex}`} aria-pressed={backgroundFillMode === "color" && backgroundColor?.toLowerCase() === hex.toLowerCase()} style={{ backgroundColor: hex }} onClick={() => setCanvasBackground("color", hex)} className="h-6 w-6 rounded-full border-2 border-border p-0 aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary" />)}</div>
      </div>
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="audio-channels-settings-heading"><h3 id="audio-channels-settings-heading" className="text-sm font-medium">Audio</h3>
      <Card className="flex flex-col justify-between gap-3 rounded-md bg-bg-2 p-3 shadow-none sm:flex-row sm:items-center"><div className="min-w-0"><h4 className="text-xs font-medium">Default audio channels</h4><p className="mt-1 text-[11px] leading-4 text-fg-2">Applies to files you import from now on. &quot;Use file&quot; keeps each file&apos;s own channels; Mono plays the first channel only, Stereo plays the first two channels. Change any clip later with Clip &gt; Audio Channels.</p></div>
        <PreferenceSelect label="Default audio channels" value={preferences.defaultAudioChannels} options={CHANNEL_PRESETS.map(preset => ({ value: preset, label: CHANNEL_PRESET_LABELS[preset] }))} onChange={value => useSettingsStore.getState().setDefaultAudioChannels(value as ChannelPreset)} />
      </Card>
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="autosave-settings-heading"><h3 id="autosave-settings-heading" className="text-sm font-medium">Auto-Save</h3>
      <div className="flex items-center justify-between gap-3"><div><Label htmlFor={autoSaveId} className="text-xs">Enable auto-save</Label><p id={`${autoSaveId}-description`} className="mt-1 text-[11px] leading-4 text-fg-2">Automatically save your project at regular intervals</p></div><Switch id={autoSaveId} aria-describedby={`${autoSaveId}-description`} checked={preferences.autoSave} onCheckedChange={value => useSettingsStore.getState().setAutoSave(value)} /></div>
      {preferences.autoSave && <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><span className="text-xs text-fg-2">Save every</span><PreferenceSelect label="Auto-save interval" value={String(preferences.autoSaveInterval)} onChange={value => useSettingsStore.getState().setAutoSaveInterval(Number(value))} options={[1, 2, 5, 10, 15, 30].map(value => ({ value: String(value), label: `${value} minute${value === 1 ? "" : "s"}` }))} /></div>}
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="audio-output-settings-heading"><h3 id="audio-output-settings-heading" className="text-sm font-medium">Audio Output</h3>
      <div className="flex flex-col gap-2"><div className="min-w-0"><Label className="text-xs">Playback device</Label><p className="mt-1 text-[11px] leading-4 text-fg-2">Choose the speakers or headphones used for preview. Remembered between sessions; falls back to the system default if the device is unplugged.</p></div>
        <AudioOutputSelect testId="prefs-audio-output" className="w-full max-w-[320px]" /></div>
    </section>
    <hr className="border-border" />
    <section className="space-y-3" aria-labelledby="connection-settings-heading"><h3 id="connection-settings-heading" className="text-sm font-medium">AI Connections</h3><p className="text-xs leading-5 text-fg-2">Connect a compatible endpoint you control. OpenReel does not choose a vendor or model for you.</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-fg-2">Text to Speech/Voice To Speech/Sound Effects</span><PreferenceSelect label="Text to Speech provider" value={preferences.defaultTtsProvider} onChange={value => useSettingsStore.getState().setDefaultTtsProvider(value as TtsProvider)} options={SERVICE_REGISTRY.filter(service => service.id === "elevenlabs").map(service => ({ value: service.id, label: service.label }))} /></div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs text-fg-2">Creative tools API format</span><PreferenceSelect label="Creative tools API format" value={preferences.defaultLlmProvider ?? "none"} onChange={value => useSettingsStore.getState().setDefaultLlmProvider(value === "none" ? null : value as LlmProvider)} options={[{ value: "none", label: "Choose API format…" }, ...llmProviders.map(service => ({ value: service.id, label: service.label }))]} /></div>
      {preferences.defaultLlmProvider ? <Card className="space-y-3 rounded-md bg-bg-2 p-3 shadow-none"><div><h4 className="text-xs font-medium">{preferences.defaultLlmProvider === "anthropic-compatible" ? "Anthropic-compatible endpoint" : "OpenAI-compatible endpoint"}</h4><p className="mt-1 text-[11px] leading-4 text-fg-2">Enter your API host and the exact tool-capable model ID exposed by that host.</p></div>
        <PreferenceText label="Base URL" value={preferences.llmBaseUrl} onChange={value => useSettingsStore.getState().setLlmBaseUrl(value)} placeholder={preferences.defaultLlmProvider === "anthropic-compatible" ? "https://gateway.example/v1" : "http://localhost:11434/v1"} />
        <PreferenceText label="Model ID" value={preferences.llmModel} onChange={value => useSettingsStore.getState().setLlmModel(value)} placeholder="Enter any model ID from your endpoint" />
        <p className="text-[11px] leading-4 text-fg-2">Used by voice scripts and shader generation. Configure timeline chat in the AI Editor settings tab.</p>
      </Card> : <Card className="rounded-md border-dashed bg-bg-2 p-3 text-xs text-fg-2 shadow-none">Choose an API format to configure your host and model.</Card>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-xs text-fg-2">AI Aggregator</h4><p className="mt-1 text-[11px] leading-4 text-fg-2">Video/image generation, upscaling, and creative AI tools</p></div><PreferenceSelect label="AI Aggregator provider" value={preferences.defaultAggregator} onChange={value => useSettingsStore.getState().setDefaultAggregator(value as AggregatorProvider)} options={aggregatorProviders.map(service => ({ value: service.id, label: service.label }))} /></div>
    </section>
  </div>;
}
