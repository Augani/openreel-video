# OpenReel Image – Feature Status Matrix

This document audits which tools, panels, and export formats in the
`apps/image` editor are **Fully Implemented**, **Partially Wired**, or
**UI-Only / Stub**.

> **Legend**
>
> | Symbol | Meaning |
> |--------|---------|
> | ✅ | Fully implemented – persists data, renders correctly, passes tests |
> | 🔶 | Partially wired – UI exists, some logic works but missing features |
> | 🔲 | UI-only / stub – panel rendered but no backing logic |

---

## Toolbar Tools

| Tool | Status | Notes |
|------|--------|-------|
| Select / Move | ✅ | Transform handles, multi-select, keyboard nudge |
| Crop | 🔶 | Basic crop rect; no aspect-lock presets or straighten |
| Text | ✅ | Create text layers with full style panel |
| Rectangle | ✅ | Shape layer, fill/stroke, corner radius |
| Ellipse | ✅ | Shape layer |
| Triangle | ✅ | Shape layer |
| Polygon | ✅ | Shape layer, configurable sides |
| Star | ✅ | Shape layer, inner radius |
| Line / Arrow | ✅ | Shape layer with stroke |
| Pen / Path | 🔶 | Path drawing works; bezier handle editing absent |
| Brush | 🔶 | UI and settings panel exist; stroke not persisted |
| Eraser | 🔶 | Tool panel exists; raster edit not implemented |
| Paint Bucket | 🔶 | Tool panel exists; flood-fill not wired |
| Gradient Fill | 🔶 | Tool panel exists; gradient application incomplete |
| Clone Stamp | 🔲 | Panel rendered; no backing logic |
| Healing Brush | 🔲 | Panel rendered; no backing logic |
| Spot Healing | 🔲 | Panel rendered; no backing logic |
| Dodge / Burn | 🔲 | Panel rendered; no backing logic |
| Sponge | 🔲 | Panel rendered; no backing logic |
| Smudge | 🔲 | Panel rendered; no backing logic |
| Blur / Sharpen Brush | 🔲 | Panel rendered; no backing logic |
| Rectangular Selection | 🔶 | Selection state exists; fill/copy/cut not selection-aware |
| Elliptical Selection | 🔲 | Not implemented |
| Lasso | 🔲 | Not implemented |
| Magic Wand | 🔲 | Not implemented |
| Liquify | 🔲 | Panel rendered; no warp logic |
| Hand / Pan | ✅ | Canvas pan with space-drag and middle-click |
| Zoom | ✅ | Scroll wheel and Z-key shortcuts |
| Color Picker | ✅ | Foreground / background colour wells |

---

## Inspector Panels

| Panel | Status | Notes |
|-------|--------|-------|
| Transform | ✅ | X/Y/W/H, rotation, flip, opacity |
| Alignment | ✅ | Align/distribute relative to artboard or selection |
| Appearance (Blend Mode + Opacity) | ✅ | Persists to layer |
| Effects – Shadow | ✅ | Enabled, colour, blur, offset |
| Effects – Inner Shadow | ✅ | Enabled, colour, blur, offset |
| Effects – Stroke | ✅ | Enabled, colour, width, style |
| Effects – Glow | ✅ | Enabled, colour, blur, intensity |
| Text (font, size, style) | ✅ | All style options; no live canvas cursor |
| Shape (fill, gradient, noise, stroke) | ✅ | Full shapeStyle controls |
| Artboard (size, background) | ✅ | |
| Image Controls (brightness etc.) | ✅ | Non-destructive filter object |
| Levels | ✅ | Data model + UI; GPU render pending |
| Curves | ✅ | Data model + UI; GPU render pending |
| Color Balance | ✅ | Data model + UI; GPU render pending |
| Selective Color | ✅ | Data model + UI; GPU render pending |
| Black & White | ✅ | Data model + UI; GPU render pending |
| Photo Filter | ✅ | Data model + UI; GPU render pending |
| Channel Mixer | ✅ | Data model + UI; GPU render pending |
| Gradient Map | ✅ | Data model + UI; GPU render pending |
| Posterize | ✅ | Data model + UI; GPU render pending |
| Threshold | ✅ | Data model + UI; GPU render pending |
| Mask | 🔶 | Data model exists; mask painting not wired |
| Background Removal | ✅ | Uses @imgly/background-removal locally |
| Selection Tools Panel | 🔶 | Basic rect selection; no ellipse/lasso/wand |
| Brush Settings | 🔶 | UI wired; brush strokes not persisted to layer |
| Eraser Settings | 🔲 | UI only |
| Paint Bucket Settings | 🔲 | UI only |
| Gradient Tool Settings | 🔶 | UI partially wired |
| Clone Stamp Settings | 🔲 | UI only |
| Healing Brush Settings | 🔲 | UI only |
| Spot Healing Settings | 🔲 | UI only |
| Dodge/Burn Settings | 🔲 | UI only |
| Sponge Settings | 🔲 | UI only |
| Smudge Settings | 🔲 | UI only |
| Blur/Sharpen Settings | 🔲 | UI only |
| Liquify Settings | 🔲 | UI only |
| Crop Settings | 🔶 | No aspect preset or perspective crop |
| Pen/Path Settings | 🔶 | Path creation works; anchor editing missing |
| Transform Tool Panel | ✅ | Free transform functional |
| Filter Presets | 🔶 | Preset list UI; save/load not persisted |
| Color Harmony | 🔲 | UI panel rendered; logic not wired |
| History Panel | 🔶 | Snapshot history works; no command names shown |

---

## Left Panel Tabs

| Tab | Status | Notes |
|-----|--------|-------|
| Layers | ✅ | Add/remove/reorder/group/visibility/lock |
| Templates | 🔶 | Hard-coded template placeholders; no real template data |
| Assets / Uploads | 🔶 | Upload and display works; no asset library categories |
| Pages (Artboards) | ✅ | Add/remove/rename/reorder artboards |

---

## Export Formats

| Format | Status | Notes |
|--------|--------|-------|
| PNG | ✅ | Full artboard render with transparency |
| JPEG | ✅ | Quality setting applied; transparent bg becomes white |
| WebP | ✅ | Quality setting applied |
| SVG | 🔲 | Option present in UI; not implemented |
| PDF | 🔲 | Option present in UI; not implemented |

---

## Data & Storage

| Feature | Status | Notes |
|---------|--------|-------|
| Project create / load / close | ✅ | Via Zustand store |
| Project schema validation (Zod) | ✅ | Added in baseline stabilisation |
| Project migration (version field) | ✅ | v0 → v1 migration added |
| Auto-save (localStorage) | 🔶 | Saves on dirty, no IndexedDB yet |
| `.orimg` export (zip) | 🔲 | Not implemented |
| Asset deduplication | 🔲 | Not implemented |
| Blob URL lifecycle management | 🔲 | Not implemented |

---

## Test Coverage

| Area | Status |
|------|--------|
| Project creation | ✅ |
| Layer add / remove / duplicate / reorder | ✅ |
| Artboard add / remove / update | ✅ |
| Export service (PNG / JPG / WebP) | ✅ |
| Project schema validation | ✅ |
| Project migration | ✅ |
| React component tests | 🔲 |
| Playwright E2E smoke tests | 🔲 |
| Visual regression tests | 🔲 |
