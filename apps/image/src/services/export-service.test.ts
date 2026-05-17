import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportProject, exportArtboard, type ExportOptions } from './export-service';
import type { Project, Artboard } from '../types/project';

// ── Canvas mock ──────────────────────────────────────────────────────────────
//
// jsdom does not implement 2D canvas rendering, so we wire up a minimal mock
// that records calls and satisfies the toBlob contract.

function makeMockCanvas() {
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 100 }),
    getImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }),
    putImageData: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue({
      addColorStop: vi.fn(),
    }),
    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
    createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    setLineDash: vi.fn(),
  };

  let blobCallback: ((blob: Blob | null) => void) | null = null;

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(ctx),
    toBlob: vi.fn().mockImplementation(
      (callback: (blob: Blob | null) => void, _type?: string, _quality?: number) => {
        blobCallback = callback;
        // Resolve asynchronously to simulate browser behaviour.
        setTimeout(() => callback(new Blob(['pixel-data'], { type: _type ?? 'image/png' })), 0);
      },
    ),
    toDataURL: vi.fn().mockReturnValue('data:image/png;base64,abc'),
    _ctx: ctx,
    _triggerBlob: () => blobCallback?.(new Blob(['pixel-data'])),
  };

  return canvas;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeArtboard(id = 'ab1'): Artboard {
  return {
    id,
    name: 'Artboard 1',
    size: { width: 400, height: 300 },
    background: { type: 'color', color: '#ffffff' },
    layerIds: [],
    position: { x: 0, y: 0 },
  };
}

function makeProject(artboards?: Artboard[]): Project {
  const ab = artboards ?? [makeArtboard('ab1')];
  return {
    id: 'proj1',
    name: 'Test Project',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    artboards: ab,
    layers: {},
    assets: {},
    exportPresets: [],
    activeArtboardId: ab[0].id,
  };
}

function makeOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
  return {
    format: 'png',
    quality: 'high',
    scale: 1,
    background: 'include',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('export-service', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createElementSpy: any;

  beforeEach(() => {
    // Intercept canvas creation and substitute the mock.
    createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return makeMockCanvas() as unknown as HTMLCanvasElement;
      }
      // Fall through for other tags (e.g. img).
      return document.createElement.call(document, tag);
    });
  });

  afterEach(() => {
    createElementSpy.mockRestore();
  });

  // ── exportArtboard ──────────────────────────────────────────────────────

  describe('exportArtboard', () => {
    it('returns a Blob for PNG format', async () => {
      const project = makeProject();
      const blob = await exportArtboard(project, project.artboards[0], makeOptions({ format: 'png' }));
      expect(blob).toBeInstanceOf(Blob);
    });

    it('returns a Blob for JPEG format', async () => {
      const project = makeProject();
      const blob = await exportArtboard(
        project,
        project.artboards[0],
        makeOptions({ format: 'jpg' }),
      );
      expect(blob).toBeInstanceOf(Blob);
    });

    it('returns a Blob for WebP format', async () => {
      const project = makeProject();
      const blob = await exportArtboard(
        project,
        project.artboards[0],
        makeOptions({ format: 'webp' }),
      );
      expect(blob).toBeInstanceOf(Blob);
    });

    it('creates a canvas with the artboard dimensions × scale', async () => {
      const project = makeProject();
      await exportArtboard(project, project.artboards[0], makeOptions({ scale: 2 }));

      // The canvas created by exportArtboard should have been given the scaled dimensions.
      const mockCanvas = (createElementSpy.mock.results[0].value as ReturnType<typeof makeMockCanvas>);
      expect(mockCanvas.width).toBe(800);  // 400 × 2
      expect(mockCanvas.height).toBe(600); // 300 × 2
    });

    it('fills background colour for include mode', async () => {
      const project = makeProject();
      const artboard = project.artboards[0];
      await exportArtboard(project, artboard, makeOptions({ background: 'include', format: 'png' }));

      const mockCanvas = createElementSpy.mock.results[0].value as ReturnType<typeof makeMockCanvas>;
      expect(mockCanvas._ctx.fillRect).toHaveBeenCalled();
    });

    it('does not fill background for transparent mode (PNG)', async () => {
      const project = makeProject();
      await exportArtboard(
        project,
        project.artboards[0],
        makeOptions({ background: 'transparent', format: 'png' }),
      );

      const mockCanvas = createElementSpy.mock.results[0].value as ReturnType<typeof makeMockCanvas>;
      expect(mockCanvas._ctx.fillRect).not.toHaveBeenCalled();
    });

    it('always fills background for JPEG (no transparency)', async () => {
      const project = makeProject([
        { ...makeArtboard(), background: { type: 'transparent' } },
      ]);
      await exportArtboard(
        project,
        project.artboards[0],
        makeOptions({ background: 'transparent', format: 'jpg' }),
      );

      const mockCanvas = createElementSpy.mock.results[0].value as ReturnType<typeof makeMockCanvas>;
      expect(mockCanvas._ctx.fillRect).toHaveBeenCalled();
    });
  });

  // ── exportProject ───────────────────────────────────────────────────────

  describe('exportProject', () => {
    it('returns one blob per artboard', async () => {
      const project = makeProject([makeArtboard('a1'), makeArtboard('a2')]);
      const blobs = await exportProject(project, makeOptions());
      expect(blobs).toHaveLength(2);
    });

    it('filters artboards when artboardIds is provided', async () => {
      const project = makeProject([makeArtboard('a1'), makeArtboard('a2'), makeArtboard('a3')]);
      const blobs = await exportProject(project, makeOptions({ artboardIds: ['a1', 'a3'] }));
      expect(blobs).toHaveLength(2);
    });

    it('calls onProgress with 100% at the end', async () => {
      const project = makeProject();
      const onProgress = vi.fn();
      await exportProject(project, makeOptions(), onProgress);
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
      expect(lastCall[0]).toBe(100);
    });

    it('reports progress for each artboard', async () => {
      const project = makeProject([makeArtboard('a1'), makeArtboard('a2')]);
      const onProgress = vi.fn();
      await exportProject(project, makeOptions(), onProgress);
      // At minimum one intermediate progress call before the final 100.
      expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
