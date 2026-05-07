# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Development
pnpm dev                    # Start Vite dev server (http://localhost:5173)

# Testing
pnpm test                   # Run all tests in watch mode
pnpm test:run              # Run tests once (CI mode)

# Build
pnpm build                  # Build WASM + web app for production
pnpm build:wasm            # Build only WASM modules (FFT, WAV, beat detection)

# Quality
pnpm typecheck             # TypeScript type checking
pnpm lint                  # ESLint

# Single package testing (from root)
pnpm --filter @openreel/core test:run
pnpm --filter @openreel/web test:run

#deploy app to cloudflare
pnpm deploy
```

## Architecture

### Monorepo Structure

- **`apps/web`** (`@openreel/web`) - React frontend with Vite, deployed to Cloudflare Pages
- **`apps/cloud`** - Cloudflare Workers API (Hono framework)
- **`packages/core`** (`@openreel/core`) - Core editing logic, imported by web app

### Core Package Modules (`packages/core/src/`)

| Module | Purpose |
|--------|---------|
| `video/` | WebGPU rendering, upscaling shaders, video effects |
| `audio/` | Web Audio API, effects (EQ, reverb, etc.), beat detection |
| `graphics/` | Canvas/THREE.js, shapes, SVG rendering |
| `text/` | Text rendering, 20+ text animations |
| `export/` | Video encoding via ffmpeg.wasm/MediaBunny |
| `storage/` | IndexedDB persistence, project serialization |
| `device/` | Device capabilities detection, export time estimation |
| `timeline/` | Timeline data structures, clip management |
| `actions/` | Undoable action system |
| `wasm/` | AssemblyScript modules (FFT, WAV, beat detection) |

### Web App Structure (`apps/web/src/`)

| Directory | Purpose |
|-----------|---------|
| `stores/` | Zustand state: `project-store`, `engine-store`, `timeline-store`, `ui-store` |
| `components/editor/` | Editor UI: Timeline, Preview, Inspector panels |
| `bridges/` | Coordinates between React and core engines |
| `services/` | Auto-save, keyboard shortcuts, screen recording |

### Key Design Patterns

1. **Action-based editing** - All edits dispatch actions that are undoable/redoable
2. **Engine separation** - Video, audio, graphics engines are independent singletons
3. **Immutable state** - Zustand stores with Immer for predictable updates
4. **Progressive enhancement** - WebGPU → Canvas2D fallback

### State Flow

```
User Action → Zustand Store → Action Dispatch → Core Engine → State Update → React Re-render
```

### Export Pipeline

Uses ffmpeg.wasm (multi-threaded) with WebCodecs for hardware encoding when available:
```
Timeline → Frame Rendering → VideoEncoder → ffmpeg muxing → Blob download
```

## Testing

- Framework: Vitest
- React testing: `@testing-library/react`
- Test files: `*.test.ts` or `*.test.tsx` alongside source files
- Property-based testing available via `fast-check`

## Conventions

- Commit messages: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, etc.)
- Branch naming: `feat/description` or `fix/description`
- TypeScript strict mode, avoid `any`
- Components: PascalCase, functions: camelCase, constants: UPPER_SNAKE_CASE
