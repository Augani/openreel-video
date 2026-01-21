# Open Reel Image

**Browser-based graphic design editor for creators**

A professional-grade image editor built for the web. Create stunning social media graphics, thumbnails, posters, and marketing materials—entirely offline, entirely in your browser.

---

## Vision

Open Reel Image is the image editing companion to Open Reel Video. While the video editor handles motion content, Open Reel Image focuses on **static graphic design**—the posters, thumbnails, social posts, and marketing materials that creators need alongside their videos.

Think **Canva meets Photoshop**, but:
- Runs 100% in the browser (WebAssembly-powered)
- Works completely offline
- No account required
- No watermarks
- Professional export quality

---

## Target Users

| User Type | Use Case |
|-----------|----------|
| **YouTube Creators** | Thumbnails, channel art, end screens |
| **Social Media Managers** | Instagram posts, stories, carousels, Twitter graphics |
| **Small Business Owners** | Marketing materials, promotional graphics, sale banners |
| **Content Creators** | Podcast covers, Twitch overlays, TikTok covers |
| **Students & Educators** | Presentations, infographics, educational materials |
| **Freelancers** | Quick client deliverables without expensive software |

---

## Core Philosophy

### Offline-First
Every feature works without an internet connection. Assets, fonts, templates, and processing all happen locally. Your work stays on your device.

### Performance-Obsessed
WASM-powered image processing means native-speed filters and effects. No waiting for cloud rendering. Real-time preview of every adjustment.

### Creator-Focused
Features designed around what creators actually need—social media templates, one-click background removal, export presets for every platform.

### No Compromises
Professional output quality. No artificial limitations. No "upgrade to export in HD" paywalls.

---

## Feature Set

### Canvas & Composition

- **Infinite canvas** with zoom and pan
- **Multi-page projects** for carousels and multi-slide content
- **Layer system** with full z-ordering, grouping, and nesting
- **Precise positioning** with guides, grids, and smart snapping
- **Alignment tools** for professional layouts
- **Artboard presets** for every social platform
- **Custom canvas sizes** up to 8K resolution
- **Rulers and measurements** in pixels, inches, or cm

### Image Editing

- **Non-destructive editing** — original always preserved
- **Smart crop** with aspect ratio presets
- **Background removal** powered by on-device ML
- **Image adjustments:**
  - Brightness, contrast, exposure
  - Saturation, vibrance, temperature, tint
  - Highlights, shadows, whites, blacks
  - Clarity, sharpness, noise reduction
  - Vignette, grain, fade
- **Filter presets** — Instagram-style one-click looks
- **Custom LUT support** — import your own color grades
- **Blend modes** — all standard Photoshop modes
- **Masking** — layer masks, clipping masks, alpha masks
- **Image effects:**
  - Blur (Gaussian, motion, radial, tilt-shift)
  - Glow and bloom
  - Chromatic aberration
  - Glitch and distortion
  - Duotone and color mapping
  - Pixelate and mosaic

### Text & Typography

- **Rich text editing** with full formatting
- **Google Fonts integration** — 1500+ fonts, cached offline
- **Custom font upload** — TTF, OTF, WOFF, WOFF2
- **Text styling:**
  - Font weight, style, size
  - Letter spacing, line height, word spacing
  - Text alignment and justification
  - Uppercase, lowercase, title case transforms
- **Text effects:**
  - Drop shadow with blur and offset
  - Outline/stroke with variable width
  - Glow and outer glow
  - Gradient fills (linear, radial, angular)
  - Image/pattern fills
  - 3D/perspective transforms
- **Curved text** — text on path, arc, wave, circle
- **Text boxes** with overflow handling
- **Vertical text** for Asian languages
- **Emoji support** with full color rendering

### Shapes & Graphics

- **Basic shapes** — rectangle, ellipse, triangle, polygon, star
- **Rounded corners** with per-corner control
- **Custom paths** — pen tool for vector drawing
- **Shape fills:**
  - Solid color
  - Linear gradient
  - Radial gradient
  - Image fill
  - Pattern fill
- **Stroke options:**
  - Variable width
  - Dash patterns
  - Line caps and joins
- **Boolean operations** — union, subtract, intersect, exclude
- **SVG import** — bring in custom vector graphics
- **Icon library** — built-in icon pack for common needs

### Stickers & Elements

- **Built-in sticker packs:**
  - Arrows and callouts
  - Social media icons
  - Emojis and reactions
  - Decorative elements
  - Seasonal/holiday themes
- **Search functionality** across all elements
- **Favorites** for frequently used items
- **Custom element upload** — PNG, SVG, WebP

### Templates

- **Professional templates** for every use case:
  - YouTube thumbnails
  - Instagram posts, stories, reels covers
  - Facebook posts and covers
  - Twitter/X posts and headers
  - LinkedIn posts and banners
  - Pinterest pins
  - TikTok covers
  - Twitch panels and overlays
  - Podcast covers
  - Event flyers
  - Business cards
  - Presentations
  - Infographics
- **Template categories:**
  - Gaming
  - Beauty & Fashion
  - Food & Cooking
  - Tech & Reviews
  - Education
  - Business
  - Lifestyle
  - Fitness
  - Travel
  - Music
- **Placeholder system** — easily swap images and text
- **Color scheme adaptation** — templates adjust to your brand colors
- **Save as template** — create your own reusable templates

### Brand Kit (Pro Feature Consideration)

- **Brand colors** — save your palette
- **Brand fonts** — quick access to your typography
- **Logos** — store multiple versions
- **Brand templates** — consistent starting points

### History & Workflow

- **Unlimited undo/redo** with visual history
- **Auto-save** to browser storage
- **Project versioning** — restore previous saves
- **Duplicate project** for variations
- **Copy/paste between projects**
- **Keyboard shortcuts** for power users

---

## Export Capabilities

### Formats

| Format | Use Case | Features |
|--------|----------|----------|
| **PNG** | Web, transparency needed | 8-bit, 24-bit, 32-bit (alpha) |
| **JPEG** | Photos, smaller files | Quality 1-100, progressive |
| **WebP** | Modern web, best compression | Lossy and lossless |
| **AVIF** | Next-gen, smallest files | High quality at low sizes |
| **PDF** | Print, documents | Single and multi-page |
| **SVG** | Scalable graphics | Vector elements only |

### Export Options

- **Resolution control** — 1x, 2x, 3x, or custom scale
- **DPI settings** — 72 (web), 150 (draft), 300 (print), custom
- **Color profile** — sRGB, Adobe RGB, CMYK preview
- **Compression control** — balance quality vs file size
- **Batch export** — all pages at once
- **Export presets:**
  - Web optimized (smallest file)
  - Social media (platform-specific)
  - Print ready (300 DPI, full quality)
  - Custom saved presets

### Platform Presets

One-click export optimized for:

| Platform | Dimensions | Notes |
|----------|------------|-------|
| Instagram Post | 1080×1080 | Square, optimized compression |
| Instagram Story | 1080×1920 | 9:16, safe zones marked |
| Instagram Carousel | 1080×1350 | 4:5, multi-page |
| YouTube Thumbnail | 1280×720 | 16:9, <2MB for upload |
| Twitter/X Post | 1200×675 | 16:9, optimized |
| Facebook Post | 1200×630 | Link preview optimized |
| LinkedIn Post | 1200×627 | Professional network |
| Pinterest Pin | 1000×1500 | 2:3 vertical |
| TikTok Cover | 1080×1920 | Story format |
| Twitch Panel | 320×160 | Small, crisp |

---

## Technical Architecture

### Performance Targets

| Metric | Target |
|--------|--------|
| Initial load | < 3 seconds |
| Filter preview | < 50ms |
| Background removal | < 3 seconds (first), < 500ms (cached) |
| Export (1080p) | < 2 seconds |
| Export (4K) | < 5 seconds |
| Memory usage | < 500MB typical, < 2GB max |

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| UI Framework | React + TypeScript | Component architecture |
| State Management | Zustand | Lightweight, performant |
| Canvas Rendering | HTML Canvas + WebGL | Hardware acceleration |
| Image Processing | Rust → WebAssembly | Native-speed filters |
| ML Inference | ONNX Runtime (WASM) | Background removal |
| Text Rendering | Canvas 2D + Custom | Full typography control |
| Storage | IndexedDB | Projects, assets, cache |
| Fonts | Local cache + Google Fonts API | Offline typography |

### Offline Capabilities

**What works offline:**
- All editing features
- All filters and effects
- Background removal (models cached on first use)
- Export in all formats
- Previously loaded fonts
- Saved templates
- Project save/load

**What requires internet:**
- Loading new Google Fonts (first time only)
- Downloading new templates
- Stock image search (if implemented)

### Data Storage

| Data Type | Storage | Size Limit |
|-----------|---------|------------|
| Projects | IndexedDB | ~500MB per project |
| Assets | IndexedDB | Cached until cleared |
| Fonts | Cache API | ~200MB font cache |
| Templates | IndexedDB | Cached on first use |
| Preferences | LocalStorage | < 1MB |
| ML Models | Cache API | ~50MB per model |

---

## User Interface

### Main Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Logo   File  Edit  View  [Canvas: 1080×1080]  [Zoom: 100%]  ⚙ │
├─────────┬───────────────────────────────────────────┬───────────┤
│         │                                           │           │
│ Tools   │                                           │ Inspector │
│         │                                           │           │
│ ▢ Select│                                           │ Position  │
│ ✋ Hand  │                                           │ x: 120    │
│ T Text  │              Canvas Area                  │ y: 340    │
│ □ Shape │                                           │           │
│ 🖼 Image │                                           │ Size      │
│ ⬡ Element│                                          │ w: 200    │
│         │                                           │ h: 150    │
│         │                                           │           │
│         │                                           │ Rotation  │
│         │                                           │ 0°        │
│         │                                           │           │
│         │                                           │ Opacity   │
│         │                                           │ ████ 100% │
│         │                                           │           │
│         │                                           │ Blend     │
│         │                                           │ Normal ▼  │
│         │                                           │           │
├─────────┴───────────────────────────────────────────┴───────────┤
│  Layers                                                         │
│  ├─ 📝 Headline Text                                    👁 🔒    │
│  ├─ 🖼 Background Image                                 👁 🔒    │
│  └─ ▢ Rectangle                                        👁 🔓    │
├─────────────────────────────────────────────────────────────────┤
│  [Page 1] [Page 2] [Page 3] [+]                      [Export ▼] │
└─────────────────────────────────────────────────────────────────┘
```

### Panel System

| Panel | Purpose |
|-------|---------|
| **Toolbar** | Primary tools (select, hand, text, shapes, etc.) |
| **Layers** | Layer management, visibility, locking, ordering |
| **Inspector** | Context-sensitive properties for selected item |
| **Pages** | Multi-page navigation for carousels |
| **Assets** | Project images, uploaded files |
| **Templates** | Browse and apply templates |
| **Elements** | Stickers, icons, shapes library |
| **Text** | Font browser, text presets |
| **Filters** | Image filter presets |
| **Adjustments** | Image adjustment sliders |

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Select tool | V |
| Hand/pan | H or Space (hold) |
| Text tool | T |
| Rectangle | R |
| Ellipse | E |
| Zoom in | Cmd/Ctrl + = |
| Zoom out | Cmd/Ctrl + - |
| Fit to screen | Cmd/Ctrl + 0 |
| Undo | Cmd/Ctrl + Z |
| Redo | Cmd/Ctrl + Shift + Z |
| Copy | Cmd/Ctrl + C |
| Paste | Cmd/Ctrl + V |
| Duplicate | Cmd/Ctrl + D |
| Delete | Backspace / Delete |
| Select all | Cmd/Ctrl + A |
| Deselect | Escape |
| Group | Cmd/Ctrl + G |
| Ungroup | Cmd/Ctrl + Shift + G |
| Bring forward | Cmd/Ctrl + ] |
| Send backward | Cmd/Ctrl + [ |
| Bring to front | Cmd/Ctrl + Shift + ] |
| Send to back | Cmd/Ctrl + Shift + [ |
| Save | Cmd/Ctrl + S |
| Export | Cmd/Ctrl + Shift + E |
| New project | Cmd/Ctrl + N |
| Open project | Cmd/Ctrl + O |

---

## Competitive Comparison

| Feature | Open Reel Image | Canva | Adobe Express | Photopea |
|---------|-----------------|-------|---------------|----------|
| **Offline support** | ✅ Full | ❌ | ❌ | ⚠️ Partial |
| **Free tier** | ✅ Unlimited | ⚠️ Limited | ⚠️ Limited | ✅ Full |
| **No account needed** | ✅ | ❌ | ❌ | ✅ |
| **No watermarks** | ✅ | ⚠️ Pro elements | ⚠️ Pro elements | ✅ |
| **Background removal** | ✅ Free | ⚠️ Pro | ⚠️ Pro | ✅ Free |
| **Custom fonts** | ✅ | ⚠️ Pro | ⚠️ Pro | ✅ |
| **Export quality** | ✅ Full | ⚠️ Pro | ⚠️ Pro | ✅ |
| **Privacy** | ✅ Local only | ❌ Cloud | ❌ Cloud | ⚠️ |
| **Speed** | ✅ WASM | ⚠️ Cloud | ⚠️ Cloud | ✅ |
| **Advanced filters** | ✅ | ⚠️ Basic | ⚠️ Basic | ✅ |
| **Layer masks** | ✅ | ❌ | ❌ | ✅ |
| **Templates** | ✅ | ✅ Best | ✅ Good | ❌ |

### Our Advantages

1. **True offline** — Not just "works offline sometimes"
2. **Privacy-first** — Nothing leaves your device
3. **No artificial limits** — Full features, no paywalls
4. **Performance** — WASM means desktop-class speed
5. **Open source** — Transparent, community-driven

### Where We Need to Excel

1. **Templates** — Need volume and quality to compete with Canva
2. **Elements library** — Stickers, icons, graphics collection
3. **Ease of use** — Canva's simplicity is their moat
4. **Polish** — Professional feel in every interaction

---

## Development Phases

### Phase 1: Foundation (MVP)
**Goal:** Basic working editor with core features

- [ ] Project management (new, save, load, export)
- [ ] Canvas with zoom, pan, guides
- [ ] Image layer with basic transforms
- [ ] Image import (drag & drop, file picker)
- [ ] Basic adjustments (brightness, contrast, saturation)
- [ ] Text layer with basic formatting
- [ ] Rectangle and ellipse shapes
- [ ] Layer panel with reordering
- [ ] PNG and JPEG export
- [ ] Undo/redo system

### Phase 2: Image Power
**Goal:** Professional image editing capabilities

- [ ] Full adjustment panel (all sliders)
- [ ] Filter presets (20+ looks)
- [ ] Background removal (ML-powered)
- [ ] Blend modes
- [ ] Basic masking
- [ ] Crop with aspect ratios
- [ ] Image effects (blur, vignette, grain)

### Phase 3: Typography
**Goal:** Professional text capabilities

- [ ] Google Fonts integration with offline cache
- [ ] Custom font upload
- [ ] Text effects (shadow, outline, glow)
- [ ] Gradient text fills
- [ ] Curved text / text on path
- [ ] Text presets and styles

### Phase 4: Shapes & Elements
**Goal:** Complete graphics toolkit

- [ ] Full shape library
- [ ] Pen tool for custom paths
- [ ] Shape fills (gradient, image, pattern)
- [ ] Boolean operations
- [ ] SVG import
- [ ] Built-in elements/stickers library
- [ ] Icon pack

### Phase 5: Templates & Presets
**Goal:** Quick-start for users

- [ ] Template browser UI
- [ ] 50+ starter templates
- [ ] Social media presets
- [ ] Export presets
- [ ] Save as template
- [ ] Placeholder system

### Phase 6: Polish & Pro Features
**Goal:** Professional-grade experience

- [ ] Multi-page / carousel support
- [ ] Brand kit
- [ ] Advanced masking
- [ ] Keyboard shortcuts (full set)
- [ ] Context menus
- [ ] Snap and alignment guides
- [ ] Rulers and measurements
- [ ] PDF export
- [ ] WebP and AVIF export

### Phase 7: Scale & Performance
**Goal:** Handle any project size

- [ ] Large canvas optimization (8K+)
- [ ] Memory management
- [ ] Progressive loading
- [ ] Background processing
- [ ] Performance monitoring

---

## Success Metrics

### User Experience Goals

| Metric | Target |
|--------|--------|
| Time to first design | < 2 minutes |
| Learning curve | Productive in < 10 minutes |
| Export satisfaction | > 95% usable on first try |
| Return usage | > 60% come back within 7 days |

### Technical Goals

| Metric | Target |
|--------|--------|
| Lighthouse performance | > 90 |
| First contentful paint | < 1.5s |
| Time to interactive | < 3s |
| Core Web Vitals | All green |
| Offline reliability | 100% feature parity |
| Crash rate | < 0.1% of sessions |

### Growth Goals

| Metric | 3 Month | 6 Month | 12 Month |
|--------|---------|---------|----------|
| Monthly active users | 1,000 | 10,000 | 50,000 |
| Projects created | 5,000 | 75,000 | 500,000 |
| Exports completed | 10,000 | 150,000 | 1,000,000 |

---

## Content Strategy

### Templates Needed (Priority Order)

1. **YouTube Thumbnails** — Biggest creator need
   - Gaming (Minecraft, Fortnite, variety)
   - Tech reviews
   - Vlogs
   - Tutorials
   - Reactions
   - Podcasts

2. **Instagram** — Highest volume
   - Quote posts
   - Product showcases
   - Announcements
   - Carousels (educational, storytelling)
   - Story templates

3. **Business** — Monetization potential
   - Sale announcements
   - Product launches
   - Event promotions
   - Hiring posts
   - Testimonials

4. **General Social** — Cross-platform
   - Motivational quotes
   - Tips and tricks
   - Before/after
   - Lists and rankings

### Element Library Priorities

1. **Arrows and callouts** — Tutorial creators need these
2. **Social icons** — Platform logos, engagement icons
3. **Frames and borders** — Easy visual enhancement
4. **Badges and labels** — "New", "Sale", "Free", etc.
5. **Abstract shapes** — Background decoration
6. **Emojis** — Universal engagement

---

## Integration with Open Reel Video

### Shared Components

- Asset management system
- Export pipeline
- Color picker
- Font system
- Project storage

### Workflow Integration

1. **Thumbnail from video** — Extract frame, edit as image
2. **Shared assets** — Use same images across video and graphics
3. **Consistent branding** — Same fonts, colors across projects
4. **Quick access** — Switch between video and image editor

### Unified Export

- Export video + thumbnail together
- Batch export for YouTube (video + thumbnail + end screen)
- Consistent file naming

---

## Future Considerations

### Potential Future Features

- **AI-powered features:**
  - Text suggestions
  - Layout recommendations
  - Color palette generation
  - Image enhancement
  - Object removal
  
- **Collaboration:**
  - Real-time multiplayer editing
  - Comments and feedback
  - Version history with contributors
  
- **Stock integration:**
  - Free stock image search
  - Icon library expansion
  - Premium asset marketplace
  
- **Animation (light):**
  - Animated stickers
  - GIF export
  - Simple motion for social posts

### Monetization Options (If Needed)

- Premium templates
- Extended element library
- Priority support
- Team features
- Custom branding removal
- API access

---

## File Structure (Proposed)

```
openreel/
├── apps/
│   ├── video/                    # Video editor app
│   └── image/                    # Image editor app
│       ├── src/
│       │   ├── components/
│       │   │   ├── canvas/       # Canvas and rendering
│       │   │   ├── panels/       # UI panels
│       │   │   ├── tools/        # Tool implementations
│       │   │   └── ui/           # Shared UI components
│       │   ├── engine/
│       │   │   ├── layers/       # Layer system
│       │   │   ├── history/      # Undo/redo
│       │   │   ├── export/       # Export pipeline
│       │   │   └── project/      # Project management
│       │   ├── stores/           # State management
│       │   ├── hooks/            # React hooks
│       │   └── utils/            # Utilities
│       └── public/
│           ├── templates/        # Template JSON files
│           └── elements/         # Built-in elements
├── packages/
│   ├── image-core/               # Rust WASM image processing
│   │   ├── src/
│   │   │   ├── adjustments/
│   │   │   ├── filters/
│   │   │   ├── effects/
│   │   │   ├── composite/
│   │   │   └── export/
│   │   └── Cargo.toml
│   ├── ml-models/                # ONNX models for ML features
│   └── shared/                   # Shared utilities
└── docs/
    ├── IMAGE_README.md           # This document
    └── architecture/
```

---

## Open Questions

1. **Template creation** — Build custom tool or use Figma/design tool exports?
2. **Element library source** — License existing or create original?
3. **Font licensing** — Google Fonts sufficient or need more?
4. **Mobile support** — Responsive or separate mobile app?

---

## Summary

Open Reel Image is a browser-based graphic design editor that gives creators professional tools without the complexity of Photoshop or the limitations of Canva's free tier. By running entirely offline with WASM-powered processing, we offer speed, privacy, and freedom that cloud-based competitors can't match.

The editor focuses on the graphics creators actually need—social media posts, thumbnails, marketing materials—with templates and presets that make professional design accessible to everyone.

**Our promise:** Professional graphic design, free forever, no internet required.

---

*Last updated: January 2025*
*Version: 0.1.0-planning*
