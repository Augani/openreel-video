import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { Button, Input, ColorPicker, ScrollArea, Collapsible, CollapsibleTrigger, CollapsibleContent, Label, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@openreel/ui";
import {
  Circle,
  Hexagon,
  Box,
  CircleDot,
  Cone,
  Cylinder,
  Gem,
  FileCode,
  Upload,
  ChevronRight,
} from "lucide-react";
import type { ShapeType } from "@openreel/core";
import type { BackgroundPreset } from "../../services/background-generator";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { insertTimelineOverlay } from "../../stores/project/insert-timeline-overlay";
import { toast } from "../../stores/notification-store";
const StickerPickerPanel = lazy(() => import("./inspector/StickerPickerPanel").then((m) => ({ default: m.StickerPickerPanel })));
import { EssentialGraphicsPanel } from "./graphics/EssentialGraphicsPanel";

// The overlay catalog (and its preview compositor) is only fetched when the Overlays tab is first opened.
const OverlayCards = lazy(() => import("./graphics/OverlayCards").then((m) => ({ default: m.OverlayCards })));
import { WorkspaceTabs, workspaceTabPanel } from "./WorkspacePrimitives";
import { FONT_CATEGORIES, useCustomFonts } from "./inspector/font-options";
import { useTextFontEdit } from "./inspector/useTextFontEdit";
import { ensureFontFamily } from "../../services/project-fonts";

/** The overlay templates offered here, in order: each is a real editing template, drawn on the card by its own recipe. */
export const OVERLAY_TEMPLATE_IDS = ["overlay-progress-bar", "cinema-letterbox", "overlay-follow-callout", "cinema-light-frame"] as const;
const builtInFonts = Object.values(FONT_CATEGORIES).flat();
const DEFAULT_BRAND_COLORS = ["#34D399", "#111318", "#FFFFFF", "#8A8F98"] as const;

/** New shapes use the brand primary once a brand kit exists, otherwise white, never a stock blue. */
function newShapeStyle(): { fill: { type: "solid"; color: string; opacity: number }; stroke: { color: string; width: number; opacity: number } } {
  let color = "#FFFFFF";
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("openreel-brand-colors") ?? "null");
    if (Array.isArray(saved) && typeof saved[0] === "string" && /^#[0-9a-f]{6}$/i.test(saved[0])) color = saved[0];
  } catch {
    // Unreadable storage falls back to white.
  }
  return { fill: { type: "solid", color, opacity: 1 }, stroke: { color, width: 0, opacity: 0 } };
}

function readBrandValue(key: string, fallback: string) {
  try { return localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}
function saveBrandValue(key: string, value: string) {
  try { localStorage.setItem(key, value); }
  catch { /* Keep the current in-memory brand usable if storage is unavailable. */ }
}

const shapes = [
  { type: "rectangle", label: "Rectangle", path: "M4 6h16v12H4z" },
  {
    type: "rectangle",
    label: "Rounded rectangle",
    rounded: true,
    path: "M7 6h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z",
  },
  { type: "circle", label: "Circle", path: "M12 20a8 8 0 1 0 0-16a8 8 0 1 0 0 16" },
  { type: "triangle", label: "Triangle", path: "M12 4l9 16H3z" },
  { type: "line", label: "Line", path: "M4 20 20 4" },
  { type: "arrow", label: "Arrow", path: "M4 12h15M13 6l6 6-6 6" },
  { type: "star", label: "Star", path: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" },
  { type: "speech-bubble", label: "Speech bubble", path: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" },
] as const;
const moreShapes = [{ type: "polygon", label: "Polygon", icon: Hexagon }] as const;
const meshes = [
  { type: "mesh-cube", label: "Cube", icon: Box },
  { type: "mesh-sphere", label: "Sphere", icon: Circle },
  { type: "mesh-torus", label: "Torus", icon: CircleDot },
  { type: "mesh-cone", label: "Cone", icon: Cone },
  { type: "mesh-cylinder", label: "Cylinder", icon: Cylinder },
  { type: "mesh-icosahedron", label: "Icosahedron", icon: Gem },
] as const;
export function WorkspaceGraphicsPanel({
  backgrounds,
  onImportBackground,
  generatingBackground,
}: {
  backgrounds: readonly BackgroundPreset[];
  onImportBackground: (preset: BackgroundPreset) => void;
  generatingBackground: string | null;
}) {
  const [tab, setTab] = useState("shapes");
  const [category, setCategory] = useState("all");
  const [colors, setColors] = useState<string[]>(() => {
    const fallback = [...DEFAULT_BRAND_COLORS];
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("openreel-brand-colors") ?? "null",
      );
      return Array.isArray(saved) &&
        saved.length === 4 &&
        saved.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
        ? saved
        : fallback;
    } catch {
      return fallback;
    }
  });
  const [brandName, setBrandName] = useState(
    () => readBrandValue("openreel-brand-name", ""),
  );
  const [brandFont, setBrandFont] = useState(() => readBrandValue("openreel-brand-font", "Inter"));
  const [applyingBrand, setApplyingBrand] = useState(false);
  const [brandConfigured, setBrandConfigured] = useState(() => {
    try {
      return ["openreel-brand-name", "openreel-brand-colors", "openreel-brand-font"].some(key => localStorage.getItem(key) !== null);
    } catch {
      return false;
    }
  });
  const brandRevision = useRef(0);
  const applyRequest = useRef<object | null>(null);
  const project = useProjectStore(state => state.project);
  const targets = useMemo(() => {
    const tracks = new Map(project.timeline.tracks.map(track => [track.id, track]));
    return (project.textClips ?? []).filter(clip => {
      const track = tracks.get(clip.trackId);
      return track && !track.locked;
    });
  }, [project.textClips, project.timeline.tracks]);
  const beginBrandEdit = useTextFontEdit(project.id, targets.map(clip => clip.id));
  const customFonts = useCustomFonts();
  const fonts = useMemo(() => [...new Set([brandFont, ...builtInFonts, ...customFonts])], [brandFont, customFonts]);
  const applyBrand = async () => {
    if (applyRequest.current || targets.length === 0) return;
    const request = {};
    applyRequest.current = request;
    setApplyingBrand(true);
    const revision = brandRevision.current;
    const edit = beginBrandEdit();
    const originalColors = new Map(targets.map(clip => [clip.id, clip.style.color]));
    try {
      const samples = new Map<string | number, Set<string>>();
      for (const clip of targets) {
        const characters = samples.get(clip.style.fontWeight) ?? new Set<string>();
        for (const character of clip.text) characters.add(character);
        samples.set(clip.style.fontWeight, characters);
      }
      await Promise.all([...samples].map(([weight, characters]) => ensureFontFamily(brandFont, weight, [...characters].join(""))));
      const current = useProjectStore.getState().project;
      const currentTracks = new Map(current.timeline.tracks.map(track => [track.id, track]));
      const currentTitles = new Map(current.textClips?.map(clip => [clip.id, clip]));
      const stillEditable = targets.every(target => {
        const clip = currentTitles.get(target.id);
        const track = clip && currentTracks.get(clip.trackId);
        return clip && track && !track.locked && clip.style.color === originalColors.get(target.id);
      });
      if (revision !== brandRevision.current || !stillEditable || !edit.isCurrent()) return;
      if (edit.commit({ fontFamily: brandFont, color: colors[0] })) {
        toast.success("Brand applied", `${targets.length} ${targets.length === 1 ? "title" : "titles"} updated. Locked tracks are unchanged.`);
      }
    } catch {
      if (revision === brandRevision.current && edit.isCurrent()) toast.error("Font unavailable", "Choose another brand font or import it in advanced text settings.");
    } finally {
      edit.cancel();
      if (applyRequest.current === request) {
        applyRequest.current = null;
        setApplyingBrand(false);
      }
    }
  };
  const svgInput = useRef<HTMLInputElement>(null);
  const addShape = async (type: ShapeType, rounded = false) => {
    const time = useTimelineStore.getState().playheadPosition;
    const created = await insertTimelineOverlay(time, 5, (trackId) => {
      const store = useProjectStore.getState();
      const shape = store.createShapeClip(
        trackId,
        time,
        type,
        5,
        { ...newShapeStyle(), ...(rounded ? { cornerRadius: 24 } : {}) },
      );
      if (shape && type.startsWith("mesh-")) {
        return store.updateShapeTransform(shape.id, { rotate3d: { x: -18, y: 28, z: 0 } }) ?? shape;
      }
      return shape;
    });
    if (created) {
      useUIStore.getState().select({
        type: "shape-clip",
        id: created.id,
        trackId: created.trackId,
      });
    }
  };
  const addSpeechBubble = async () => {
    const time = useTimelineStore.getState().playheadPosition;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><path d="M24 8h272a16 16 0 0 1 16 16v112a16 16 0 0 1-16 16H88l-48 24v-24H24a16 16 0 0 1-16-16V24A16 16 0 0 1 24 8Z" fill="#ffffff" stroke="#ffffff" stroke-width="2"/></svg>';
    const created = await insertTimelineOverlay(time, 5, (trackId) =>
      useProjectStore.getState().importSVG(svg, trackId, time, 5),
    );
    if (created)
      useUIStore.getState().select({
        type: "shape-clip",
        id: created.id,
        trackId: created.trackId,
      });
  };
  const applyOverlay = (id: string) => {
    const state = useProjectStore.getState();
    const selected = useUIStore.getState().getSelectedClipIds();
    const target = selected.map((id) => state.getClip(id)).find(Boolean);
    if (!target) {
      toast.warning(
        "Select a video or image",
        "Overlays are placed over the selected clip.",
      );
      return;
    }
    if (!state.applyEditingTemplate(id, target.id))
      toast.error("Could not add overlay", "Try selecting a different clip.");
  };
  return (
    <div className="workspace-graphics-panel flex flex-col min-h-0 h-full">
      <WorkspaceTabs
        label="Graphics sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "templates", label: "Templates" },
          { value: "shapes", label: "Shapes" },
          { value: "overlays", label: "Overlays" },
          { value: "stickers", label: "Stickers" },
          { value: "brand", label: "Brand" },
        ]}
      />
      <ScrollArea
        {...workspaceTabPanel("Graphics sections", tab)}
        className="flex-1 min-h-0"
      >
        <div className="px-2.5 py-3">
          {tab === "stickers" ? (
            <Suspense fallback={null}>
              <StickerPickerPanel />
            </Suspense>
          ) : tab === "templates" ? (
            <EssentialGraphicsPanel />
          ) : tab === "brand" ? (
            <div className="workspace-brand-editor">
              <h3>BRAND KIT</h3>
              {!brandConfigured && (
                <p className="workspace-brand-empty" role="status">
                  No brand kit yet. Name your brand and pick its colors and title font. New shapes use the first color, and one click restyles every title.
                </p>
              )}
              <label>
                Brand name
                <Input
                  placeholder="Your brand"
                  value={brandName}
                  onChange={(e) => {
                    setBrandName(e.target.value);
                    setBrandConfigured(true);
                    saveBrandValue("openreel-brand-name", e.target.value);
                  }}
                />
              </label>
              <p className="text-[11px] text-fg-muted" id="brand-colors-label">Brand colors</p>
              <div className="workspace-brand-colors" role="group" aria-labelledby="brand-colors-label">
                {colors.map((color, i) => (
                  <ColorPicker
                    key={i}
                    label={`Brand color ${i + 1}`}
                    value={color}
                    onChange={(next) => {
                      const updated = colors.map((c, j) =>
                        i === j ? next : c,
                      );
                      brandRevision.current += 1;
                      setBrandConfigured(true);
                      setColors(updated);
                      saveBrandValue(
                        "openreel-brand-colors",
                        JSON.stringify(updated),
                      );
                    }}
                  />
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                <Label htmlFor="brand-title-font" className="text-[11px] text-fg-muted">Title font</Label>
                <Select value={brandFont} onValueChange={family => {
                  brandRevision.current += 1;
                  setBrandConfigured(true);
                  setBrandFont(family);
                  saveBrandValue("openreel-brand-font", family);
                }}>
                  <SelectTrigger id="brand-title-font" aria-label="Brand title font" className="h-[30px] text-[12px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{fonts.map(family => <SelectItem key={family} value={family}>{family}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {brandConfigured && (
                <div className="workspace-brand-summary">
                  <strong>Apply your brand</strong>
                  <p className="workspace-brand-fonts">
                    {targets.length === 0
                      ? "Add a title to the timeline, then restyle it with your title font and first color."
                      : `Restyles ${targets.length} ${targets.length === 1 ? "title" : "titles"} with ${brandFont} and ${colors[0]}. Locked tracks are skipped.`}
                  </p>
                  <Button className="workspace-apply-brand" aria-label="Apply brand to all titles" aria-busy={applyingBrand} disabled={applyingBrand || targets.length === 0} onClick={() => { void applyBrand(); }}>
                    {applyingBrand ? "Applying brand…" : "Apply brand to all titles"}
                  </Button>
                </div>
              )}
              <p>
                Saved on this device. Choose a color when styling your text and
                graphics.
              </p>
            </div>
          ) : (
            <>
              {tab === "shapes" && (
                <>
                  <h3>SHAPES</h3>
                  <div className="workspace-shape-grid workspace-primary-shape-grid">
                    {shapes.map(
                      (shape) => (
                        <Button
                          key={shape.label}
                          variant="outline"
                          aria-label={shape.label}
                          title={shape.label}
                          onClick={() => {
                            if (shape.type === "speech-bubble") {
                              void addSpeechBubble();
                              return;
                            }
                            void addShape(
                              shape.type,
                              "rounded" in shape && shape.rounded,
                            );
                          }}
                        >
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={shape.path} /></svg>
                        </Button>
                      ),
                    )}
                  </div>
                </>
              )}
              {tab === "overlays" && <><h3>OVERLAYS</h3>
              <Suspense fallback={null}><OverlayCards onApply={applyOverlay} /></Suspense>
              </>}
              <Collapsible className="workspace-more-graphics">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="workspace-more-graphics-trigger group flex h-auto w-full items-center justify-between gap-2 whitespace-normal rounded-md px-2 py-1.5 text-left text-[length:inherit] font-normal leading-[inherit] hover:bg-bg-2 [&_svg]:size-3">
                    <span className="min-w-0">More shapes, 3D & backgrounds</span>
                    <ChevronRight size={12} className="shrink-0 text-fg-muted transition-transform group-data-[state=open]:rotate-90" aria-hidden />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <h3>MORE SHAPES</h3>
                  <div className="workspace-shape-grid">
                    {moreShapes.map(shape => (
                      <Button key={shape.type} variant="outline" aria-label={shape.label} title={shape.label} onClick={() => { void addShape(shape.type); }}>
                        <shape.icon />
                      </Button>
                    ))}
                  </div>
                  <h3>3D OBJECTS</h3>
                  <div className="workspace-shape-grid">
                    {meshes.map((mesh) => (
                      <Button
                        key={mesh.type}
                        variant="outline"
                        aria-label={mesh.label}
                        title={mesh.label}
                        onClick={() => {
                          void addShape(mesh.type);
                        }}
                      >
                        <mesh.icon />
                      </Button>
                    ))}
                  </div>
                  <h3>BACKGROUNDS</h3>
                  <div className="workspace-chips mb-2">
                    {["all", "solid", "gradient", "mesh", "pattern"].map((v) => (
                      <Button
                        key={v}
                        variant="ghost"
                        aria-pressed={category === v}
                        onClick={() => setCategory(v)}
                      >
                        {v[0].toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </div>
                  <div className="workspace-background-grid">
                    {backgrounds
                      .filter(
                        (p) => category === "all" || p.category === category,
                      )
                      .map((preset) => (
                        <Button
                          key={preset.id}
                          variant="outline"
                          title={preset.name}
                          aria-label={preset.name}
                          disabled={generatingBackground !== null}
                          onClick={() => onImportBackground(preset)}
                          style={{ background: preset.thumbnail }}
                        />
                      ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <Button
                variant="secondary"
                className="w-full mt-3 text-xs h-8"
                onClick={() => svgInput.current?.click()}
              >
                <FileCode size={14} />
                Import SVG File
              </Button>
              <Button
                variant="secondary"
                className="w-full mt-2 text-xs h-8"
                onClick={() => setTab("stickers")}
              >
                <Upload size={14} />
                Import & Add Sticker
              </Button>
              <Input
                ref={svgInput}
                className="hidden"
                type="file"
                accept=".svg,image/svg+xml"
                aria-label="Import SVG file"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  const text = await file.text();
                  const time = useTimelineStore.getState().playheadPosition;
                  const created = await insertTimelineOverlay(
                    time,
                    5,
                    (trackId) =>
                      useProjectStore.getState().importSVG(text, trackId, time),
                  );
                  if (created)
                    useUIStore.getState().select({
                      type: "shape-clip",
                      id: created.id,
                      trackId: created.trackId,
                    });
                }}
              />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
