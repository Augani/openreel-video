/**
 * The request handler behind the spectral worker. It is the same code whether it runs in the module
 * worker (spectral.worker.ts) or inline (node tests, browsers without workers), so a repair or a view
 * never depends on where it was computed.
 */
import { applySpectralRegions, computeSpectralView, type SpectralView, type SpectralViewOptions } from "./spectral-dsp";
import type { SpectralRegion } from "./spectral-regions";

export type SpectralRequest =
  | { readonly id: number; readonly kind: "repair"; readonly channels: Float32Array[]; readonly sampleRate: number; readonly regions: SpectralRegion[] }
  | { readonly id: number; readonly kind: "load"; readonly key: string; readonly mono: Float32Array; readonly sampleRate: number }
  | { readonly id: number; readonly kind: "view"; readonly key: string; readonly options: SpectralViewOptions }
  | { readonly id: number; readonly kind: "drop"; readonly key: string };

export interface SpectralResponse {
  readonly id: number;
  readonly channels?: Float32Array[];
  readonly view?: SpectralView;
  readonly ok?: boolean;
  readonly error?: string;
}

export function createSpectralHandler(): (request: SpectralRequest) => SpectralResponse {
  const sources = new Map<string, { mono: Float32Array; sampleRate: number }>();
  return (request) => {
    try {
      switch (request.kind) {
        case "repair":
          return { id: request.id, channels: applySpectralRegions(request.channels, request.sampleRate, request.regions) };
        case "load":
          sources.set(request.key, { mono: request.mono, sampleRate: request.sampleRate });
          return { id: request.id, ok: true };
        case "drop":
          sources.delete(request.key);
          return { id: request.id, ok: true };
        case "view": {
          const source = sources.get(request.key);
          if (!source) return { id: request.id, error: "spectral source not loaded" };
          return { id: request.id, view: computeSpectralView([source.mono], source.sampleRate, request.options) };
        }
      }
    } catch (error) {
      return { id: request.id, error: error instanceof Error ? error.message : String(error) };
    }
  };
}
