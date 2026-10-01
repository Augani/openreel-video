# OpenReel Video — Android Port Spec
## Part 01: App Structure, Navigation, and Top-Level Screens

This document describes the iOS SwiftUI implementation of OpenReel Video's app shell, navigation graph, theme, and the screens the user sees before entering the editor. The Android team should rebuild these 1:1 in Kotlin (Jetpack Compose recommended).

---

## 1. Overview

The app is a mobile video editor. The top-level surface consists of:

- An **App entry point** (`Openreel_VideoApp`) that boots the audio session for playback and injects two app-wide state objects (`AppState`, `PlaybackController`) into the SwiftUI environment.
- A **Root view** (`RootView`) which is the master switch between three top-level destinations:
  1. **Onboarding** (first launch only — gated by `@AppStorage("hasCompletedOnboarding")`)
  2. **A loading screen** (shown while the app bootstraps stored projects)
  3. **The Library tab shell** (Home + Projects tabs) OR **the Editor**, depending on `appState.activeScreen`.
- A **modal `NewProjectSheet`** that can be presented from anywhere via `appState.presentNewProjectSheet()`.
- A **global error alert** driven by `appState.importErrorMessage`.

The Library has two tabs:
- **Home** — hero/marketing copy, "New Project" call-to-action, horizontal carousel of recent projects, "Quick Start" platform presets, and quick-action grid (Photo Tools, Quick Trim).
- **Projects** — full grid/list browser of stored projects with storage usage summary and delete actions.

`ContentView` is a thin wrapper around `RootView` and exists only as the boilerplate Xcode template root.

---

## 2. Navigation Graph

```
Openreel_VideoApp (Scene)
└── ContentView
    └── RootView                               ← decides which top-level destination is shown
        ├── if !hasCompletedOnboarding         → OnboardingView (full screen, no chrome)
        ├── else if bootstrapping              → loadingView (centered ProgressView + label)
        ├── else if activeScreen == .editor    → EditorView (covered in other docs)
        └── else                               → LibraryTabView
                                                  ├── Tab "Home"      → NavigationStack { HomeView }
                                                  │                       └── NavigationLink → PhotoEnhancementView (Quick Start grid)
                                                  └── Tab "Projects"  → NavigationStack { ProjectsView }

Modals / overlays presented on top of RootView regardless of the current branch:
  • Sheet:  NewProjectSheet  (presentationDetents = .fraction(0.5), drag indicator visible)
  • Alert:  "OpenReel" alert with appState.importErrorMessage (OK / cancel role)
  • Confirmation dialog: project deletion (shown from ProjectsView)
```

### Entry & boot sequence
1. App launches → `Openreel_VideoApp.init()` configures `AVAudioSession` with category `.playback`, mode `.moviePlayback`, and activates it. (Android equivalent: configure `AudioAttributes` for media playback / request audio focus when starting playback.)
2. `RootView` mounts, runs `.task { await appState.bootstrap() }` — loads stored projects from disk.
3. While `appState.isBootstrapping && !appState.hasBootstrapped`, the loading view is shown.
4. After bootstrap, `LibraryTabView` is shown (or onboarding if the flag is unset, but onboarding is checked *first*, before bootstrap state).

### Conditional onboarding gate
- Persisted in `UserDefaults` via `@AppStorage("hasCompletedOnboarding") Bool = false`.
- Onboarding is the only thing the user sees until either:
  - The "Skip" button in the top bar is tapped, **or**
  - The user reaches the last page and taps "Start Editing".
- Both paths call `completeOnboarding()`, which fires a medium impact haptic and sets `hasCompletedOnboarding = true`. The app immediately re-renders into the LibraryTabView.

### Tab switching semantics
The tab `TabView` selection is bound to a derived `Binding<AppState.Screen>` in `LibraryTabView.selection`:
- `appState.activeScreen` is the source of truth (`.home`, `.projects`, `.editor`).
- When mapping to a tab tag: `.projects` → `.projects` tab; `.home` and `.editor` both map to the `.home` tab. (So if the user backs out of the editor and the tab bar is re-displayed, the Home tab is selected.)
- When the user taps a tab, the setter calls `appState.showHome()` or `appState.showProjects()`. Tapping the editor tag — which is not surfaced in the UI — also routes to `showHome()`.

### Sheet presentation
- `NewProjectSheet` is presented as a bottom sheet with a half-screen detent (`.fraction(0.5)`) and a drag indicator. The sheet is dismissed by `appState.dismissNewProjectSheet()` or by the user dragging it down or tapping "Close".

### Inter-screen transitions (entry points to the sheet)
- **HomeView** header `+` button → `appState.presentNewProjectSheet()`
- **HomeView** "New Project" card → `appState.presentNewProjectSheet()`
- **HomeView** "Quick Trim" card → `appState.presentNewProjectSheet()`
- **HomeView** Quick Start platform preset card → `appState.quickCreateProject(...)` (creates a project directly, *no* sheet)
- **HomeView** "Photo Tools" → `NavigationLink` to `PhotoEnhancementView` (inside the Home `NavigationStack`)
- **ProjectsView** toolbar `+` → `appState.presentNewProjectSheet()`
- **ProjectsView** empty state "New Project" → `appState.presentNewProjectSheet()`
- **NewProjectSheet** "Create Project" → `appState.createProject()` (which navigates to the editor by setting `activeScreen = .editor`).

---

## 3. Theme & Design Tokens

All tokens live in `Theme.swift`. Colors are dynamic (separate light/dark hex codes).

### Color tokens (hex codes, exact)

| Token              | Light       | Dark        | Use |
|--------------------|-------------|-------------|-----|
| `background`       | `#FBFCF8`   | `#0D0D0D`   | Root window background |
| `surface`          | `#F0F4EE`   | `#1A1A1A`   | Inset cards/inputs (level 1) |
| `surfaceElevated`  | `#FFFFFF`   | `#262626`   | Elevated cards, tab bar bg, sheet content (level 2) |
| `accent`           | `#047857`   | `#047857`   | Primary brand green — buttons, highlights, selection |
| `accentSecondary`  | `#036B3A`   | `#036B3A`   | Darker brand green (used by project styling) |
| `textPrimary`      | `#101814`   | `#FFFFFF`   | Primary text |
| `textSecondary`    | `#5F6F67`   | `#A3A3A3`   | Secondary/caption text |
| `destructive`      | `#DC2626`   | `#EF4444`   | Destructive actions (delete) |

Implementation detail: `OpenReelTheme.dynamicColor(light:dark:)` wraps `UIColor { traitCollection in ... }` so the colors react to system light/dark mode automatically. On Android, define two `Colors` palettes (light and dark) inside a Material 3 `ColorScheme` and let the system switch by `isSystemInDarkTheme()`.

### Project-card gradient styles (`AppState.ProjectStyle`)

| Style    | Start RGB (0–1)              | End RGB (0–1)                |
|----------|------------------------------|------------------------------|
| emerald  | (0.08, 0.32, 0.20)           | (0.14, 0.79, 0.47)           |
| cobalt   | (0.11, 0.18, 0.37)           | (0.27, 0.49, 0.98)           |
| amber    | (0.32, 0.21, 0.09)           | (0.98, 0.73, 0.20)           |
| coral    | (0.40, 0.14, 0.17)           | (0.97, 0.43, 0.39)           |

All gradients use `LinearGradient(startPoint: .topLeading, endPoint: .bottomTrailing)`.

### Typography tokens (`Font` extension)

All use `design: .rounded` unless noted. Map to a rounded sans-serif on Android — recommend **SF Pro Rounded** equivalent: `Nunito`, `Quicksand`, or Google's `Manrope`. For monospaced text use a mono font like `JetBrains Mono` / `Roboto Mono`.

| Token         | Size | Weight    | Design     |
|---------------|------|-----------|------------|
| `reelDisplay` | 34   | bold      | rounded    |
| `reelSection` | 16   | semibold  | rounded    |
| `reelBody`    | 15   | medium    | rounded    |
| `reelCaption` | 12   | medium    | rounded    |
| `reelMono`    | 13   | medium    | monospaced |

(Use these sizes as `sp` on Android.)

### Inline font usages (not tokens, but recurring)
- Logo wordmark: 20pt bold rounded (`HomeView` header), 17pt bold rounded (`OnboardingView` top bar)
- Hero title: 26pt bold rounded
- Section labels: 15pt bold rounded
- Body subcaptions: 13–14pt medium rounded
- Tiny labels (carousel chips): 10–12pt
- Monospaced counters: 10–13pt monospaced (`reelMono` style)

### Corner radii (used across screens)

| Use                              | Radius (pt/dp) | Style |
|----------------------------------|----------------|-------|
| Small chips/blocks (clip blocks) | 7             | continuous |
| Small surfaces (track badge, inspector buttons, lane bg) | 10 | continuous |
| Small action labels (Quick Start row) | 12         | continuous |
| Mid surfaces (lists, hero card)  | 14            | continuous |
| Cards (New Project card, presets) | 16           | continuous |
| Empty state, storage card        | 18            | continuous |
| Sheet content / large cards      | 18 or 24      | continuous |

iOS `RoundedRectangle(cornerRadius: X, style: .continuous)` ⇢ Android: use `RoundedCornerShape(X.dp)` (Compose lacks a true "continuous corner" curve — closest equivalent is `AbsoluteSmoothCornerShape` from third-party libs, otherwise `RoundedCornerShape` is acceptable).

### Common paddings/spacings (recurring values)
- Screen edge horizontal padding: `20` (Home), `16` (Projects), `22` (Onboarding)
- Section vertical gap: `24–28`
- Card internal padding: `10–16`
- Inline element spacing: `6, 8, 10, 12, 14, 16`

### Shadows
The app uses fairly subtle drop shadows. Key examples:
- Onboarding action button: `.shadow(color: accent.opacity(0.24), radius: 14, y: 8)`
- Onboarding editor card: `.shadow(color: .black.opacity(0.10), radius: 24, y: 14)`
- Onboarding inspector pill: `.shadow(color: .black.opacity(0.16), radius: 8, y: 4)`
- Home hero sun glow: `.shadow(color: accent.opacity(0.32), radius: 12)`

Android: `Modifier.shadow(elevation, shape, ambientColor, spotColor)` — match the y-offset/blur with `elevation` + `RoundedCornerShape`. Use `Modifier.drawBehind` for tinted shadows if needed.

### Animation/motion tokens
- Card press: `scaleEffect 0.97`, `opacity 0.85` for pressed state, with `.spring(response: 0.25, dampingFraction: 0.7)` — used by `HomeCardButtonStyle`.
- Home entrance: `withAnimation(.spring(response: 0.7, dampingFraction: 0.8))` setting `appearAnimation = true` on appear (fades elements in, slides hero text from -12px on x).
- Recent projects staggered entry: per-card delay `0.06 * index` with `.spring(response: 0.6, dampingFraction: 0.8)`.
- Page-indicator dot expand: `.spring(response: 0.3)`.
- Onboarding paging: `.spring(response: 0.42, dampingFraction: 0.86)`.
- Sensory haptic: `sensoryFeedback(.impact(flexibility: .soft), trigger: currentPage)` on each page change, plus a `UIImpactFeedbackGenerator(style: .medium)` on completing onboarding.

---

## 4. Per-Screen Sections

### 4.1 `Openreel_VideoApp` (App Entry)

- **Purpose**: SwiftUI app scene. Boots audio session, creates app-wide state, injects environment.
- **Layout**: a single `WindowGroup` containing `ContentView()`.
- **State**:
  - `@State private var appState = AppState()` — observable model of all app-level state (projects list, active screen, sheet flags, error messages, etc.).
  - `@State private var playbackController = PlaybackController()` — playback engine (used in the editor and inspector views).
  - Both injected via `.environment(appState)` / `.environment(playbackController)`.
- **Side effects**: `configureAudioSession()` runs in `init()`. It sets `AVAudioSession` category to `.playback`, mode `.moviePlayback`, then activates the session. Errors are logged with `print` and otherwise ignored.
- **Android mapping**: `Application` (or `MainActivity`) initializes a singleton `AppState` (use Hilt / a `ViewModelStoreOwner` at activity scope). Configure audio focus / `AudioAttributes` with `USAGE_MEDIA` + `CONTENT_TYPE_MOVIE` when the editor opens, not at app launch — Android best practice is to request audio focus only while actively playing.

---

### 4.2 `ContentView`

- **Purpose**: Boilerplate Xcode wrapper. Renders `RootView()`.
- **Android mapping**: not needed — call `RootView`'s Compose equivalent directly from `setContent {}`.

---

### 4.3 `RootView`

- **Purpose**: Top-level router and host for global sheet/alert overlays.
- **Layout (logical, not visual)**: a single `Group { ... }` whose visible content depends on three conditions in this order:
  1. `!hasCompletedOnboarding` → `OnboardingView()`
  2. else if `appState.isBootstrapping && !appState.hasBootstrapped` → `loadingView` (centered `VStack(spacing: 16)` with a `ProgressView().tint(accent)` and `Text("Loading projects")` using `.reelBody` + `textSecondary`, filled to `.frame(maxWidth: .infinity, maxHeight: .infinity)`).
  3. else if `appState.activeScreen == .editor` → `EditorView()`
  4. else → `LibraryTabView()`
- **Background**: `OpenReelTheme.background.ignoresSafeArea()` behind the entire group.
- **State**:
  - `@Environment(AppState.self) private var appState`
  - `@AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false`
- **Side effects**:
  - `.task { await appState.bootstrap() }` runs once when the view appears.
  - `.sheet(isPresented:)` shows `NewProjectSheet` with `.presentationDetents([.fraction(0.5)])` and `.presentationDragIndicator(.visible)`. Bound to `appState.isShowingNewProjectSheet`; setting it false calls `appState.dismissNewProjectSheet()`.
  - `.alert("OpenReel", isPresented:)` shows the global error. The presence of `appState.importErrorMessage` is converted to a `Bool` binding. Body has a single OK (`.cancel` role) button which calls `appState.dismissError()`. The message body is `appState.importErrorMessage ?? ""`.
- **Edge cases**:
  - If `bootstrap()` is fast, the loading screen may not render at all.
  - If `hasCompletedOnboarding` flips back to false (e.g., logout/reset), the user is re-onboarded immediately.
- **Android mapping**:
  - Use a top-level `@Composable` `RootScreen` with a `when` block over a sealed `AppDestination`.
  - The "onboarding completed" flag lives in `DataStore<Preferences>` (preferred) or `SharedPreferences`, collected via `collectAsState()`.
  - Global sheet → `ModalBottomSheet(onDismissRequest = ..., sheetState = ...)` with `skipPartiallyExpanded = false` and a `SheetState` that defaults to half-expanded (Compose's `rememberModalBottomSheetState(skipPartiallyExpanded = false)`; you may need to call `partialExpand()` on first display).
  - Global error alert → `AlertDialog(...)`.
  - Loading screen → `Box(contentAlignment = Center) { Column { CircularProgressIndicator(color = accent); Text("Loading projects") } }`.

---

### 4.4 `LibraryTabView` (private inside RootView.swift)

- **Purpose**: The two-tab home shell. Wraps each tab in its own `NavigationStack`.
- **Layout**:
  - `TabView(selection: selection) { ... }` — two tabs:
    - Tab 1 — tag `.home`. `NavigationStack { HomeView() }`. `.tabItem { Label("Home", systemImage: "house.fill") }`.
    - Tab 2 — tag `.projects`. `NavigationStack { ProjectsView() }`. `.tabItem { Label("Projects", systemImage: "film.stack") }`.
- **Visual style**:
  - Tab tint: `OpenReelTheme.accent` (`.tint(...)`).
  - Tab bar background: `.toolbarBackground(.visible, for: .tabBar)` + `.toolbarBackground(surfaceElevated, for: .tabBar)`.
- **State**: derived `Binding` (`selection`) mapping `appState.activeScreen` ↔ tab tag (see Navigation Graph for behavior).
- **Android mapping**: `Scaffold { bottomBar = { NavigationBar { ... } } }` with two `NavigationBarItem`s.
  - Tab icons: `Icons.Filled.Home` and a custom film/stack icon (or Material Symbol). The iOS icons are SF Symbols `house.fill` and `film.stack`.
  - Tab content area renders either `HomeScreen()` or `ProjectsScreen()` inside their own `NavHost` so each tab has its own back stack (Compose: separate `NavHost` per tab, or use `rememberNavController()` per tab with `BackHandler`).
  - Selected tint = accent green; container color = `surfaceElevated`.

---

### 4.5 `OnboardingView`

- **Purpose**: First-launch tutorial showing three illustrated pages selling the editor's features. User can swipe horizontally or tap "Continue" to advance, and finish with "Start Editing" or "Skip".

#### Layout (top to bottom)
1. **Top bar** (horizontal padding 22, top padding = `max(safeAreaInsets.top, 12)`):
   - `Image("AppLogo")` 28×28, fit aspect.
   - 8pt gap.
   - `Text("OpenReel")` 17pt bold rounded, `textPrimary`.
   - `Spacer`.
   - `Button("Skip")` 14pt bold rounded, `textSecondary`. Calls `completeOnboarding()`.
2. **`TabView`** (page style, no index indicator) containing 3 `OnboardingPageContent` views, each padded `.horizontal, 22`. Page transitions use `.spring(response: 0.42, dampingFraction: 0.86)`.
3. **Page indicator**: `HStack(spacing: 8)` of three `Capsule()`s.
   - Active capsule: 24 wide × 8 tall, filled with `accent`.
   - Inactive capsules: 8×8, filled with `textSecondary.opacity(0.3)`.
   - Animated with `.spring(response: 0.3)` between states.
4. **Action button** (horizontal padding 22, bottom padding = `max(safeAreaInsets.bottom, isCompact ? 14 : 24)`):
   - Full-width pill-button `RoundedRectangle(cornerRadius: 14, style: .continuous)`.
   - Background `accent`, shadow `accent.opacity(0.24)` radius 14 y 8.
   - Inside: `HStack(spacing: 8)` of label `Text("Continue")` or `Text("Start Editing")` (16pt bold rounded, white) and an icon `arrow.right` or `checkmark` (14pt bold).
   - Vertical padding 14, foreground white.
   - Sensory haptic on page change: `.sensoryFeedback(.impact(flexibility: .soft), trigger: currentPage)`.

Each page (`OnboardingPageContent`):
- **Stack** (spacing 10 or 14 depending on `isCompact`):
  - **Animated showcase** (`OnboardingShowcaseView`) — rendered with `TimelineView(.animation(minimumInterval: 1/30))` to drive 30fps animation. Inside, one of three showcases is shown based on `page.kind`:
    - `.assemble` → fake editor with timeline (animated playhead, scenes appear progressively, a "hand.draw.fill" cursor swings horizontally)
    - `.style` → glowing color-grade preview with dashed border and floating pill inspector
    - `.export` → progress ring, export-option list, and share chips
  - Height: 240 (compact) or 320.
  - **Pill eyebrow**: `HStack(spacing: 6)` of an `Image(systemName: page.symbol)` (10pt bold) and `Text(page.eyebrow)` (11pt bold rounded). Padding `(.horizontal, 10).(.vertical, 5)`. Background `accent.opacity(0.12)` in a `Capsule`. Foreground `accent`.
  - **Title** `Text(page.title)` 20pt or 24pt bold rounded, center-aligned, 2-line, `minimumScaleFactor 0.86`, `textPrimary`.
  - **Description** 13–14pt medium rounded, center-aligned, `lineSpacing 2`, `textSecondary`, `fixedSize(horizontal: false, vertical: true)`.

#### Page content
| # | eyebrow            | symbol                         | title                                                  | description                                                                 | kind        |
|---|--------------------|--------------------------------|--------------------------------------------------------|------------------------------------------------------------------------------|-------------|
| 1 | Timeline Builder   | `timeline.selection`           | "Build edits on a real multi-track timeline."         | "Import clips, layer audio and text, trim with handles, and watch the playhead move through the edit." | `.assemble` |
| 2 | Motion Studio      | `sparkles.rectangle.stack.fill`| "Style every frame with motion and effects."          | "Animate text, keyframe movement, adjust color, and preview the finished look as you edit." | `.style`    |
| 3 | Premium Export     | `square.and.arrow.up.fill`     | "Export polished video for every platform."           | "Choose quality, resolution, frame rate, and format before sharing a finished cut." | `.export`   |

#### Visual style
- Background = `OpenReelTheme.background.ignoresSafeArea()` with a linear gradient overlay:
  ```
  LinearGradient(
    colors: [ accent.opacity(0.10), background.opacity(0.0), surface.opacity(0.42) ],
    startPoint: .topLeading, endPoint: .bottomTrailing
  )
  ```
- Showcase card (`OnboardingEditorShell` and `ExportShowcase`): `surfaceElevated` background, corner radius 24, white border 8% opacity, drop shadow (black 10%) radius 24 y 14, internal padding 12.
- Showcase chrome buttons (`OnboardingChromeButton`): 30×30 circle. `accent` background if primary (white symbol), `surface` otherwise (textSecondary symbol). 11pt bold symbol.
- Animated playhead (in mini timeline): 10×12 rounded-rect head (radius 2) over a 2×82 vertical line, both `accent`. Shadow `accent.opacity(0.24)` radius 7 y 4.
- Time label on playhead: 8pt black monospaced white, padding `(.horizontal, 6).(.vertical, 3)`, capsule background `accent`.

#### Interactions
- **Swipe** horizontally between pages (standard `.page` TabView).
- **Tap** "Skip" → `completeOnboarding()`.
- **Tap** primary button → either advances `currentPage` (animated) or completes onboarding on last page.
- Each page change triggers a soft haptic; completion fires a medium impact haptic.

#### State
- `@State private var currentPage = 0` — current page index.
- `@AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false` — persists completion.

#### Edge cases
- **Compact heights** (`proxy.size.height < 720`): reduced spacings, showcase height 240, smaller title.
- Safe-area-aware: top/bottom paddings use `max(safeAreaInsets, ...)`.

#### Android mapping
- `HorizontalPager` (Foundation) for the 3 pages, `PagerState`.
- `Row` of three pill indicators (animated width via `animateDpAsState`).
- Bottom button is a `Button` with `RoundedCornerShape(14.dp)` and the same drop shadow (use `Modifier.shadow(8.dp, RoundedCornerShape(14.dp), spotColor = accent.copy(alpha = 0.24f))`).
- Haptic: `HapticFeedback.performHapticFeedback(HapticFeedbackType.LongPress)` from `LocalHapticFeedback.current`.
- "hasCompletedOnboarding" flag in `DataStore<Preferences>`.
- The animated showcases are 30fps procedural drawings — recreate with `Canvas` + `withFrameMillis` in a `LaunchedEffect`, or `rememberInfiniteTransition` for looping values, or a Lottie file pre-generated from the same logic.

---

### 4.6 `HomeView`

- **Purpose**: The marketing-y landing tab. Promotes creating new projects, surfaces recent projects, and lists platform presets and tool shortcuts.

#### Layout (vertical scroll, `ScrollView(showsIndicators: false)`)
Each section's outer padding is given in parentheses.

1. **Header** `homeHeader` (`.padding(.horizontal, 20).padding(.top, 12)`):
   - `HStack(spacing: 10)`:
     - `Image("AppLogo")` 26×26, fit aspect.
     - `Text("OpenReel")` 20pt bold rounded, `textPrimary`.
     - `Spacer`.
     - **Plus button**: 32×32 circle, `accent` background, white `plus` SF symbol 14pt bold. Calls `appState.presentNewProjectSheet()`.

2. **Hero** `heroSection` (`.padding(.horizontal, 20).padding(.top, 24)`):
   - `HStack(alignment: .center, spacing: 16)`:
     - Left: `VStack(alignment: .leading, spacing: 10)`:
       - `Text("Create\nsomething great.")` 26pt bold rounded, `textPrimary`, lineSpacing 2.
       - `Text("Professional video editing, right on your phone.")` 14pt medium rounded, `textSecondary`, lineSpacing 2.
       - Both fade in from `opacity 0` / `offset(x: -12)` on appear.
     - Right: `HomeHeroOrbitSystem()` 84×84 — an animated planetary scene (TimelineView at 30fps) with a central sun, orbiting planets, and occasional shooting stars. Scales/fades in on appear.

3. **New Project card** `newProjectAction` (`.padding(.horizontal, 20).padding(.top, 20)`):
   - Big tappable row:
     - `HStack(spacing: 14)`:
       - 42×42 circle, `accent.opacity(0.15)` fill, with `accent` `plus` symbol (16pt bold).
       - VStack:
         - `Text("New Project")` 15pt bold rounded, `textPrimary`.
         - `Text("Set resolution, frame rate, and start editing")` 12pt medium rounded, `textSecondary`.
       - `Spacer`.
       - `chevron.right` 12pt bold, `textSecondary.opacity(0.5)`.
     - Padding 14. Background `surfaceElevated` in `RoundedRectangle(cornerRadius: 16)`. Stroke border `accent.opacity(0.2)` width 1.
   - Uses `HomeCardButtonStyle` (scale 0.97 on press).
   - Calls `appState.presentNewProjectSheet()`.

4. **Recent Projects** `recentProjectsSection` (`.padding(.top, 28)`):
   - Section header row (`.padding(.horizontal, 20)`):
     - `Text("Recent")` 15pt bold rounded.
     - `Spacer`.
     - If `appState.projects` is not empty, "All projects" link → calls `appState.showProjects()`. Label is `HStack(spacing: 4)` of `Text("All projects")` (12pt semibold rounded, `accent`) + `chevron.right` (9pt bold).
   - If empty: `emptyProjectsState` — a centered card with:
     - 56×56 circle (`accent.opacity(0.08)`) holding a `film.stack` icon (22pt semibold, `accent`).
     - `Text("No projects yet")` 15pt bold rounded.
     - `Text("Your projects will appear here.\nTap + to create your first edit.")` 13pt medium rounded, `textSecondary`, centered, `lineSpacing 2`.
     - Background `surfaceElevated` in `RoundedRectangle(cornerRadius: 18)`. Border `Color.white.opacity(0.04)` width 1. Padding `(.vertical, 28)`.
     - Horizontal padding 20.
   - If non-empty: horizontal `ScrollView` showing `ProjectShowcaseCard(project:, width: 240)` for up to **6** projects (`appState.projects.prefix(6)`). Cards have 12pt spacing, padded `.horizontal, 20`. Each card fades up (`offset(y: 16)` → `0`, `opacity 0 → 1`) with a `.spring(response: 0.6, dampingFraction: 0.8)` staggered by `0.06 * index` seconds. Tap calls `appState.openProject(project)`.

5. **Quick Start** `quickStartSection` (`.padding(.horizontal, 20).padding(.top, 28)`):
   - `Text("Quick Start")` 15pt bold rounded.
   - Horizontal `ScrollView`, `HStack(spacing: 10)` of platform preset cards (one per `PlatformPreset.allCases`). Each card:
     - Width 80, vertical padding 12.
     - Top icon block: 44×44 rounded rect (radius 8), fill = `preset.accentColor.opacity(0.12)`; centered SF symbol 18pt semibold, `preset.accentColor`.
     - Label `Text(preset.label)` 12pt bold rounded, `textPrimary`.
     - Subtitle `Text(preset.subtitle)` 9pt medium rounded, `textSecondary`.
     - Background `surfaceElevated` in `RoundedRectangle(cornerRadius: 14)`. Border `preset.accentColor.opacity(0.15)` width 1.
     - On tap: `await appState.quickCreateProject(preset: projectPreset, frameRate:, name:)`.
   - Presets list (label / subtitle / symbol / accent / canvas / fps):
     | Label       | Subtitle       | SF Symbol             | Accent RGB              | Canvas         | FPS |
     |-------------|----------------|------------------------|-------------------------|----------------|-----|
     | TikTok      | "9:16 · 30fps" | `music.note`          | (0.92, 0.20, 0.40)      | 1080×1920      | 30  |
     | YT Short    | "9:16 · 30fps" | `play.rectangle.fill` | (1.00, 0.20, 0.20)      | 1080×1920      | 30  |
     | YouTube     | "16:9 · 30fps" | `play.rectangle`      | (1.00, 0.15, 0.15)      | 1920×1080      | 30  |
     | Instagram   | "1:1 · 30fps"  | `camera`              | (0.85, 0.25, 0.60)      | 1080×1080      | 30  |
     | X / Twitter | "16:9 · 30fps" | `bubble.left`         | (0.20, 0.60, 1.00)      | 1920×1080      | 30  |
     | Cinema      | "16:9 · 24fps" | `film`                | (0.95, 0.70, 0.20)      | 1920×1080      | 24  |
   - 2-column `LazyVGrid` (spacing 10) of two cards below:
     - **Photo Tools**: `NavigationLink → PhotoEnhancementView`, label `HomeQuickActionLabel(symbol: "photo.artframe", title: "Photo Tools", subtitle: "Enhance & restore")`.
     - **Quick Trim**: `HomeQuickAction(symbol: "scissors", title: "Quick Trim", subtitle: "Cut a clip")` → presents new-project sheet.
   - `HomeQuickActionLabel` style: 32×32 icon background `accent.opacity(0.12)` rounded 8, symbol `accent` 14pt semibold. Title 13pt bold rounded `textPrimary`. Subtitle 10pt medium rounded `textSecondary`. Outer padding 10. Background `surfaceElevated` in `RoundedRectangle(cornerRadius: 12)`. Border white 4%.

6. **Bottom spacer**: `Spacer(minLength: 80)` to leave room for the tab bar.

#### Background
`homeBackground`: ZStack of `OpenReelTheme.background.ignoresSafeArea()` + a linear gradient `[accent.opacity(0.04), background.opacity(0)]` from `.topLeading` to `.center` (ambient green wash).

#### Visual style
- `.navigationBarHidden(true)` — Home draws its own header.
- On appear: `withAnimation(.spring(response: 0.7, dampingFraction: 0.8)) { appearAnimation = true }` — drives hero text fade-in (offset -12 → 0, opacity 0 → 1) and hero orbit scale-in (0.8 → 1).
- Card press style: `HomeCardButtonStyle` — scale 0.97, opacity 0.85 when pressed, `.spring(response: 0.25, dampingFraction: 0.7)`.

#### Interactions
- **Plus button** in header → present sheet.
- **New Project** card → present sheet.
- **All projects** link → switch to Projects tab via `appState.showProjects()`.
- **Recent project card** → `appState.openProject(project)` (opens editor).
- **Platform preset card** → `appState.quickCreateProject(...)` (directly creates project & opens editor; no sheet).
- **Photo Tools** → push `PhotoEnhancementView` onto the Home nav stack.
- **Quick Trim** → present sheet.

#### State
- `@Environment(AppState.self) private var appState` — for projects list and actions.
- `@State private var appearAnimation = false` — local entrance animation flag.
- Recent project carousel shows at most 6 entries (`appState.projects.prefix(6)`).

#### Side effects
- Sheet presentation, navigation push, tab switch, project creation (async via `Task`).

#### Edge cases
- Empty projects → "Recent" section shows the empty-state card; "All projects" link hidden.
- Long project list → carousel caps at 6; rest accessible only via Projects tab.

#### Android mapping
- `LazyColumn { ... }` with `item { }` blocks per section, plus a horizontal `LazyRow` for the recent-projects carousel and for the quick-start preset row.
- The orbit graphic: build with Compose `Canvas` and an `InfiniteTransition`, or render a pre-made Lottie animation (preferred).
- "New Project" card → `Surface(shape = RoundedCornerShape(16.dp), color = surfaceElevated, border = BorderStroke(1.dp, accent.copy(alpha = 0.2f)), modifier = Modifier.clickable { ... }.padding(14.dp))`.
- Press animation → `Modifier.pointerInteropFilter` + `animateFloatAsState` or use `Modifier.scale(if (pressed) 0.97f else 1f)` driven by `interactionSource`.

---

### 4.7 `ProjectsView`

- **Purpose**: Full browser of stored projects with storage summary, grid/list toggle, and per-card delete confirmation.

#### Layout
- Z-stacked `OpenReelTheme.background.ignoresSafeArea()` behind a `ScrollView`.
- `ScrollView` contents (`.padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 40)`):
  - If `appState.projects.isEmpty` → `emptyState`.
  - Else:
    - **Storage overview card** (`storageOverview`):
      - `HStack` of:
        - 46×46 rounded rect (radius 14), fill `accent.opacity(0.14)`, with `internaldrive` symbol 18pt bold `accent`.
        - `VStack`:
          - `Text(totalProjectStorageLabel)` 18pt bold rounded `textPrimary` — value computed via `ByteCountFormatter.string(fromByteCount: totalProjectStorageUsage, countStyle: .file)` (e.g. "1.2 GB"). Shows "Calculating…" while storage scan is incomplete (`projectStorageUsageByID.count < projects.count`).
          - `Text(storageOverviewSubtitle)` 12pt medium rounded `textSecondary` — "1 project stored on this device" / "N projects stored on this device".
        - `Spacer`.
        - `Text(count)` 16pt bold monospaced `accent`.
      - `Text("Use the menu on any card to delete older projects and reclaim storage.")` 12pt medium rounded `textSecondary`.
      - Outer padding 16. Background `surfaceElevated`, `RoundedRectangle(cornerRadius: 18)`. Stroke border `accent.opacity(0.18)` width 1.
    - **Either grid or list view** depending on `showsGrid`:
      - **Grid** (`gridContent`): `LazyVGrid(columns: 2, spacing 12)` of `ProjectBrowserGridCard(project:, storageUsage:, onOpen:, onDelete:)`.
      - **List** (`listContent`): `LazyVStack(spacing 10)` of `ProjectBrowserRowCard(project:, storageUsage:, onOpen:, onDelete:)`.
    - Section vertical spacing inside the scroll: 20.
- `.navigationTitle("Projects")`, `.navigationBarTitleDisplayMode(.large)`.
- `.toolbarBackground(.visible, for: .navigationBar)` + `.toolbarBackground(background, for: .navigationBar)`.

#### Toolbar (top-bar trailing items, two `ToolbarItem(placement: .topBarTrailing)`)
1. **Layout-toggle group**: `HStack(spacing: 2)` of two 32×32 buttons:
   - `square.grid.2x2` symbol (grid view) — calls `showsGrid = true`.
   - `list.bullet` symbol (list view) — calls `showsGrid = false`.
   - Each `Image(systemName:)` is 14pt semibold; foreground = `accent` if selected else `textSecondary.opacity(0.4)`.
2. **Plus button**: same style as Home's header plus button — 32×32 circle, `accent` background, white `plus` 14pt bold. Calls `appState.presentNewProjectSheet()`.

#### Empty state
- Center-stacked `VStack(spacing: 20)`:
  - `film.stack` symbol 40pt light, `textSecondary`.
  - `Text("No projects yet")` 18pt bold rounded.
  - `Text("Create a project to start editing video.")` 14pt medium rounded `textSecondary`.
  - Pill button "New Project": 14pt semibold rounded white, padding `.horizontal, 20`/`.vertical, 12`, `Capsule` fill `accent`. Calls `presentNewProjectSheet()`.
- Vertical padding 60. Filled to max width.

#### Visual style
- 16pt horizontal screen padding (vs. 20 on Home).
- Storage card uses a green-tinted border to distinguish from neutral cards.

#### Interactions
- **Tap card** → `appState.openProject(project)`.
- **Card menu → Delete** → `pendingProjectDeletion = project`, opens a confirmation dialog.
- **Toolbar layout toggle** → `showsGrid = true/false`.
- **Toolbar `+`** → present sheet.

#### Deletion confirmation
`.confirmationDialog("Delete Project", titleVisibility: .visible)`:
- Destructive button labeled `"Delete \(project.name)"` → `Task { await appState.deleteProject(project); pendingProjectDeletion = nil }`.
- Cancel button labeled `"Cancel"`.
- Message: `"This removes the project, its media, thumbnails, and cached AI results from this device."`.

#### State
- `@Environment(AppState.self) private var appState`.
- `@State private var showsGrid = true` — view mode.
- `@State private var pendingProjectDeletion: OpenReelProject?` — the project the user is about to delete.
- `projectStorageRefreshSignature` — a string `"id-modifiedAt|id-modifiedAt|..."` recomputed any time projects change; used as `.task(id:)` so storage usage is re-scanned whenever projects or their modified times change.

#### Side effects
- `.task(id: projectStorageRefreshSignature) { await appState.refreshProjectStorageUsage() }` — scans on-disk storage in the background.
- Confirmation dialog presentation/dismissal.
- Async project deletion.

#### Edge cases
- **Storage still calculating** → `totalProjectStorageLabel` shows "Calculating…" until `projectStorageUsageByID.count >= projects.count`.
- **Singular / plural** subtitle (1 vs N).
- **Empty list** → swaps the entire content for the empty state.

#### Android mapping
- Scaffold with a `LargeTopAppBar(title = { Text("Projects") }, actions = { ... })`.
- Top-bar actions: a `Row` containing two `IconButton`s for grid/list, then an `IconButton` styled as a 32.dp circle with the accent background for `+`.
- Body: `LazyVerticalGrid(columns = GridCells.Fixed(2), ...)` or `LazyColumn` based on `showsGrid` state.
- Storage card: `Surface(shape = RoundedCornerShape(18.dp), color = surfaceElevated, border = BorderStroke(1.dp, accent.copy(alpha = 0.18f)), ...)`.
- Delete confirmation: `AlertDialog` with destructive button (`MaterialTheme.colorScheme.error`).
- Storage rescan: launch a `LaunchedEffect(projectsSignature) { viewModel.refreshStorage() }` keyed off the same signature.

---

### 4.8 `NewProjectSheet`

- **Purpose**: Modal sheet to configure a new project (name + resolution + frame rate) and create it.

#### Presentation
- Presented from `RootView` with `.presentationDetents([.fraction(0.5)])` and `.presentationDragIndicator(.visible)` — half-screen by default, drag indicator visible at top.
- Hosted in a `NavigationStack` so the toolbar `Close` button can appear in the nav bar.

#### Layout (vertical scroll, `padding(20)` on the inner `VStack(spacing: 24, alignment: .leading)`)
1. **Header**:
   - `Text("New Project")` 24pt bold rounded, `textPrimary`.
   - `Text("Pick a canvas and frame rate for your first edit.")` `.reelBody`, `textSecondary`.
2. **Project Name section** (VStack spacing 12):
   - Label: `Text("Project Name")` `.reelSection`, `textPrimary`.
   - `TextField("Project Name", text: $appState.newProjectConfiguration.name)`:
     - `.textInputAutocapitalization(.words)`.
     - `.padding(.horizontal, 16)`.
     - Height 52. Background `OpenReelTheme.surface` in `RoundedRectangle(cornerRadius: 16)`.
3. **Resolution section** (VStack spacing 12):
   - Label: `Text("Resolution")` `.reelSection`.
   - `LazyVGrid(columns: 2, spacing 12)` of preset buttons (one per `NewProjectConfiguration.presets`):
     - Each button:
       - `Text(preset.name)` 15pt semibold rounded.
       - `Text("\(preset.width) × \(preset.height)")` `.reelCaption`.
       - Foreground: white if selected, else `textPrimary`.
       - Background: `accent` (if selected) else `surface`, in `RoundedRectangle(cornerRadius: 16)`.
       - Min height 76, leading-aligned, padding `.horizontal, 14`.
4. **Frame Rate section** (VStack spacing 12):
   - Label: `Text("Frame Rate")` `.reelSection`.
   - `HStack(spacing: 10)` of pill buttons (one per `NewProjectConfiguration.supportedFrameRates`):
     - Label `"\(Int(frameRate)) fps"` 13pt semibold rounded.
     - Foreground white if selected else `textPrimary`.
     - Background `accent` (selected) or `surfaceElevated` (unselected), in `Capsule()`.
     - Padding `.horizontal, 14`. Height 42.
5. **Create button**:
   - `Text("Create Project")` 16pt bold rounded, white.
   - Full width, height 54. Background `accent` in `RoundedRectangle(cornerRadius: 18)`.
   - On tap: `Task { await appState.createProject() }`.

#### Toolbar
- `ToolbarItem(placement: .topBarTrailing)`: `Button("Close")` with `foregroundStyle(textSecondary)`. Calls `appState.dismissNewProjectSheet()`.

#### Background
`OpenReelTheme.background.ignoresSafeArea()` inside the `NavigationStack`'s scroll background.

#### Interactions
- Type in text field — updates `newProjectConfiguration.name`.
- Tap a resolution preset — sets `newProjectConfiguration.preset`.
- Tap a frame rate pill — sets `newProjectConfiguration.frameRate`.
- Tap "Create Project" — creates the project asynchronously; on success, `AppState` navigates to the editor.
- Tap "Close" or drag down — dismisses the sheet via `dismissNewProjectSheet()`.

#### State
- `@Environment(AppState.self) private var appState` (`@Bindable` view of it).
- All edits write through `appState.newProjectConfiguration`. Presets/frame rates come from `NewProjectConfiguration.presets` and `NewProjectConfiguration.supportedFrameRates`.

#### Edge cases
- Validation is implicit (no inline errors shown here). Creation failures surface via the global `importErrorMessage` alert in `RootView`.

#### Android mapping
- `ModalBottomSheet` (Material 3) with `skipPartiallyExpanded = false`. Use `sheetState.partialExpand()` if you want the half-detent first.
- Inner content: a `Column` inside `Modifier.verticalScroll(rememberScrollState())`.
- Resolution grid: `LazyVerticalGrid(columns = GridCells.Fixed(2), userScrollEnabled = false)` *or* a manual two-column `Row`-of-`Column`s pattern — both work.
- Frame rate pills: `Row` of `FilterChip`s or custom-styled buttons matching the green capsule.
- Use `OutlinedTextField` or a custom `BasicTextField` styled to match (no border, rounded 16.dp `surface` background, `capitalization = KeyboardCapitalization.Words`).
- Bottom "Create Project" button: full-width `Button` with `shape = RoundedCornerShape(18.dp)`.

---

## 5. Android Mapping Summary

| iOS                                          | Android (Compose)                                                                 |
|---------------------------------------------|-----------------------------------------------------------------------------------|
| `@main App` + `@Environment` injection      | `Application` + Hilt (or `ViewModelStoreOwner`) for app-scoped state              |
| `RootView` switch-by-state                  | `RootScreen` with `when (destination) { ... }`                                    |
| `TabView` (bottom tab bar)                  | `Scaffold(bottomBar = { NavigationBar { NavigationBarItem(...) } })`              |
| `NavigationStack`                           | `NavHost` (one per tab) with `rememberNavController()`                            |
| `.sheet(detents: [.fraction(0.5)])`         | `ModalBottomSheet` with `rememberModalBottomSheetState`                           |
| `.alert("...")`                             | `AlertDialog`                                                                     |
| `.confirmationDialog`                       | `AlertDialog` (destructive button + cancel) or `ModalBottomSheet`                 |
| `@AppStorage("hasCompletedOnboarding")`     | `DataStore<Preferences>` flow collected with `collectAsState()`                   |
| `@Environment(AppState.self)`               | `viewModel: AppViewModel = hiltViewModel()` (activity scope)                      |
| SF Symbols (e.g. `house.fill`, `plus`)      | Material Symbols / `androidx.compose.material.icons.filled.*` (or vector assets)  |
| `RoundedRectangle(cornerRadius:, style: .continuous)` | `RoundedCornerShape(X.dp)`                                                 |
| `LinearGradient`                            | `Brush.linearGradient(colors, start = Offset.Zero, end = ...)`                    |
| `TimelineView(.animation)`                  | `withFrameMillis { ... }` inside `LaunchedEffect`, or `rememberInfiniteTransition`|
| `Button(...).buttonStyle(.plain)` + press scale | `Modifier.clickable(interactionSource = ...)` + animated `scale`              |
| `@AppStorage`-backed dark mode dynamic color | Material 3 `lightColorScheme`/`darkColorScheme`                                  |
| `UIImpactFeedbackGenerator`                 | `LocalHapticFeedback.current.performHapticFeedback(...)`                          |
| `AVAudioSession` setup at app init          | Configure `AudioAttributes`/`AudioFocusRequest` lazily when starting playback     |
| `ByteCountFormatter`                        | `android.text.format.Formatter.formatFileSize(context, bytes)`                    |

### Naming/imagery the Android team needs
- App logo image: `AppLogo` (provide as `R.drawable.ic_app_logo`, vector or PNG).
- SF Symbols used by these screens (find Material Symbol equivalents):
  - `plus`, `chevron.right`, `house.fill`, `film.stack`, `square.grid.2x2`, `list.bullet`, `internaldrive`, `photo.artframe`, `scissors`, `arrow.right`, `checkmark`, `timeline.selection`, `sparkles.rectangle.stack.fill`, `square.and.arrow.up.fill`, `square.and.arrow.up`, `arrow.uturn.backward`, `play.fill`, `music.note`, `play.rectangle`, `play.rectangle.fill`, `camera`, `bubble.left`, `film`, `photo.fill`, `waveform`, `textformat`, `textformat.size`, `camera.filters`, `diamond.fill`, `slider.horizontal.3`, `square.and.arrow.down`, `video.fill`, `hand.draw.fill`.

### Components used outside this doc (referenced but defined elsewhere)
- `ProjectShowcaseCard(project:, width: 240)` — used on Home.
- `ProjectBrowserGridCard` / `ProjectBrowserRowCard` — used on Projects.
- `EditorView` — editor screen (separate doc).
- `PhotoEnhancementView` — pushed from Home Quick Start (separate doc).
- `AppState`, `PlaybackController`, `OpenReelProject`, `NewProjectConfiguration` — app-state types (separate doc).
