# Contributing to OpenReel

Thank you for your interest in contributing to OpenReel! This document provides guidelines and instructions for contributing.

## Table of Contents
- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Making Changes](#making-changes)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

Be respectful, constructive, and professional. We're building something great together!

## Getting Started

### Prerequisites
- Node.js 18 or higher
- pnpm (recommended) or npm
- Git
- Modern browser with WebCodecs support (Chrome 94+, Edge 94+)

### Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/augani/openreel-video.git
cd openreel-video

# 2. Install dependencies
pnpm install

# 3. Start development server
pnpm dev

# 4. Open browser to http://localhost:5173
```

## Project Structure

```
openreel/
├── apps/
│   └── web/               # Main web application
│       ├── public/        # Static assets
│       └── src/
│           ├── components/  # React components
│           ├── stores/      # State management (Zustand)
│           ├── bridges/     # Core engine bridges
│           └── services/    # Business logic
├── packages/
│   └── core/              # Shared core logic
│       ├── src/
│       │   ├── actions/     # Action system
│       │   ├── video/       # Video processing
│       │   ├── audio/       # Audio processing
│       │   ├── graphics/    # Graphics & SVG
│       │   ├── text/        # Text & titles
│       │   └── export/      # Export engine
│       └── types/         # TypeScript types
```

## Coding Standards

### TypeScript

- **Strict mode**: Always use TypeScript strict mode
- **Types**: Prefer interfaces over types for object shapes
- **No `any`**: Avoid `any` - use `unknown` or proper types
- **Naming**:
  - Components: `PascalCase` (e.g., `Timeline`, `Preview`)
  - Functions: `camelCase` (e.g., `handleClick`, `processVideo`)
  - Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_DURATION`)
  - Files: `kebab-case.tsx` or `PascalCase.tsx` for components

### Code Style

```typescript
// ✅ Good
interface VideoClip {
  id: string;
  duration: number;
  startTime: number;
}

function processClip(clip: VideoClip): ProcessedClip {
  if (!clip.id) {
    throw new Error('Clip ID is required');
  }

  return {
    ...clip,
    processed: true,
  };
}

// ❌ Avoid
function processClip(clip: any) {
  console.log('Processing...'); // Remove debug logs
  const result = clip; // Unclear what's happening
  return result;
}
```

### React Components

```typescript
// ✅ Good
interface TimelineProps {
  tracks: Track[];
  onClipSelect: (clipId: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({ tracks, onClipSelect }) => {
  const handleClick = useCallback((id: string) => {
    onClipSelect(id);
  }, [onClipSelect]);

  return (
    <div className="timeline">
      {tracks.map(track => (
        <Track key={track.id} track={track} onClick={handleClick} />
      ))}
    </div>
  );
};
```

### Comments

- **Do**: Comment complex algorithms and business logic
- **Don't**: Comment obvious code
- **Do**: Add JSDoc for public APIs
- **Don't**: Leave TODO comments without issues

```typescript
// ✅ Good - Explains WHY
// Use binary search for O(log n) performance on large timelines
const clipIndex = binarySearch(clips, targetTime);

// ❌ Bad - States the obvious
// Loop through clips
for (const clip of clips) { }

// ✅ Good - Public API documentation
/**
 * Applies a filter to a video clip
 * @param clipId - The clip identifier
 * @param filter - Filter configuration
 * @returns Updated clip with filter applied
 */
export function applyFilter(clipId: string, filter: Filter): Clip {
  // ...
}
```

## Making Changes

### 1. Create a Branch

```bash
# Feature branch
git checkout -b feat/add-transition-effects

# Bug fix branch
git checkout -b fix/timeline-scroll-bug

# Documentation
git checkout -b docs/update-contributing-guide
```

### 2. Make Your Changes

- Write clean, self-documenting code
- Follow the existing code style
- Keep commits focused and atomic
- Write meaningful commit messages

### 3. Commit Messages

Follow conventional commits:

```
feat: add crossfade transition effect
fix: resolve timeline scrubbing lag
docs: update API documentation
refactor: simplify video processing pipeline
test: add tests for audio mixer
perf: optimize waveform rendering
```

### 4. Keep Your Branch Updated

```bash
git fetch origin
git rebase origin/main
```

## Testing

### Running Tests

```bash
# Run all tests (watch mode)
pnpm test

# Run tests once (CI mode)
pnpm test:run

# Type checking
pnpm typecheck

# Linting
pnpm lint
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { processClip } from './clip-processor';

describe('processClip', () => {
  it('should process a valid clip', () => {
    const clip = { id: '123', duration: 10, startTime: 0 };
    const result = processClip(clip);

    expect(result.processed).toBe(true);
    expect(result.id).toBe('123');
  });

  it('should throw error for invalid clip', () => {
    const clip = { id: '', duration: 10, startTime: 0 };

    expect(() => processClip(clip)).toThrow('Clip ID is required');
  });
});
```

## Submitting Changes

### 1. Push Your Branch

```bash
git push origin feat/your-feature-name
```

### 2. Create a Pull Request

1. Go to GitHub and create a pull request
2. Fill out the PR template:
   - **Description**: What does this PR do?
   - **Motivation**: Why is this change needed?
   - **Testing**: How was this tested?
   - **Screenshots**: For UI changes
   - **Breaking Changes**: Any breaking changes?

### 3. PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Added/updated tests
- [ ] All tests passing

## Screenshots (if applicable)
[Add screenshots for UI changes]

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No console.log or debug code left
- [ ] Tests pass
```

### 4. Code Review Process

- Respond to feedback promptly
- Make requested changes
- Push updates to the same branch
- Re-request review when ready

## Areas to Contribute

### 🐛 Bug Fixes
- Check [Issues](https://github.com/augani/openreel/issues?q=is%3Aissue+is%3Aopen+label%3Abug)
- Reproduce the bug
- Write a failing test
- Fix the bug
- Verify the test passes

### ✨ New Features
- Discuss in [Discussions](https://github.com/augani/openreel/discussions) first
- Get approval before large changes
- Break into smaller PRs if possible
- Update documentation

### 📖 Documentation
- Fix typos and errors
- Add examples
- Improve clarity
- Add tutorials

### 🎨 Effects & Presets
- Create new video effects
- Add transition effects
- Build color grading presets
- Contribute templates

### 🧪 Testing
- Add missing tests
- Improve test coverage
- Add integration tests
- Performance testing

### 🌍 Translation
- Add new language support
- Improve existing translations
- Fix translation errors

## Development Tips

### Hot Reload
Changes to React components hot reload automatically. For core engine changes, you may need to refresh.

### Debugging
```typescript
// Use browser DevTools
// Set breakpoints in TypeScript source
// Check Network tab for media loading
// Use Performance profiler for optimization
```

### Performance
- Profile before optimizing
- Use Web Workers for heavy processing
- Leverage WebCodecs API for video
- Cache expensive computations
- Use useMemo/useCallback appropriately

### Common Issues

**Issue**: Video won't play
- Check browser support for WebCodecs
- Verify codec support
- Check browser console for errors

**Issue**: Build fails
- Clear node_modules and reinstall
- Check Node.js version (18+)
- Verify pnpm version

**Issue**: Tests fail
- Try running `pnpm test:run` for a single run
- Check for console errors
- Verify test environment setup
- Run `pnpm typecheck` to check for type errors

## Questions?

- **Discord**: [Join our Discord](https://discord.gg/openreeel)
- **Discussions**: [GitHub Discussions](https://github.com/augani/openreel/discussions)
- **Email**: contribute@openreeel.video

## Recognition

Contributors are recognized in:
- README.md contributors section
- GitHub contributors page
- Release notes for significant contributions

Thank you for contributing to OpenReel! 🎬
