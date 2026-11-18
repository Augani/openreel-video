import React, {
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useProjectStore } from "../../../../stores/project-store";
import { useTimelineStore } from "../../../../stores/timeline-store";
import { useUIStore } from "../../../../stores/ui-store";
import { EffectPreviewContext, effectPreviewsSupported } from "./preview-context";
import { clearActiveEffectPreviewEngine, setActiveEffectPreviewEngine } from "./active-engine";
import { EngineEffectRenderer } from "./effect-renderer";
import { EffectPreviewEngine, type PreviewEffectDef } from "./preview-engine";
import { previewNote } from "./preview-params";
import { createRetargeter } from "./retargeter";
import { PREVIEW_RETARGET_DEBOUNCE_MS, selectPreviewSource } from "./source-selection";
import { createWindowLoader, previewSizeForDevice } from "./window-loader";

/** How many frames past the one on screen hover playback keeps rendered. */
const HOVER_LOOKAHEAD_FRAMES = 6;


/**
 * Owns the preview engine (handed to the provider in EffectLivePreview.tsx) for the lifetime of the Effects panel and keeps it
 * pointed at the footage under the playhead. Playhead / selection / project
 * changes are observed through store subscriptions (never React renders) and
 * applied 300 ms after the last change, never during playback, so scrubbing
 * and playing do not trigger preview work.
 */
export const EffectPreviewController: React.FC<{
  onEngine: (engine: EffectPreviewEngine | null) => void;
  natural?: boolean;
}> = ({ onEngine: setEngine, natural = false }) => {

  useEffect(() => {
    if (!effectPreviewsSupported()) return undefined;
    const created = new EffectPreviewEngine({
      loader: createWindowLoader(
        (mediaId) => useProjectStore.getState().project.mediaLibrary.items.find((item) => item.id === mediaId),
        // Overlay cards are full panel width (a 12 px bar must stay visible), so they decode at that size.
        () => previewSizeForDevice(window.devicePixelRatio, natural ? 1.5 : 1),
        { natural },
      ),
      renderer: new EngineEffectRenderer(),
    });
    setEngine(created);
    setActiveEffectPreviewEngine(created);

    const evaluate = () => {
      // The playhead settled (or the transport stopped): preview work may run again.
      created.release();
      const { project } = useProjectStore.getState();
      created.setSource(
        selectPreviewSource({
          tracks: project.timeline.tracks,
          media: project.mediaLibrary.items,
          selectedClipIds: useUIStore.getState().getSelectedClipIds(),
          playhead: useTimelineStore.getState().playheadPosition,
        }),
      );
    };
    evaluate();

    const retarget = createRetargeter({
      delayMs: PREVIEW_RETARGET_DEBOUNCE_MS,
      // Playing: the playhead moves every frame. Re-targeting waits for the stop (the state change schedules again).
      isPlaying: () => useTimelineStore.getState().playbackState === "playing",
      evaluate,
    });
    const schedule = retarget.schedule;
    const offTimeline = useTimelineStore.subscribe((state, previous) => {
      if (state.playheadPosition !== previous.playheadPosition || state.playbackState !== previous.playbackState) {
        // Scrubbing / playing: no new preview render may start until the playhead settles, so previews never
        // compete with the program monitor for the main thread. Already-cached cards keep showing their poster.
        created.hold();
        schedule();
      }
    });
    const offSelection = useUIStore.subscribe((state, previous) => {
      if (state.selectedItems !== previous.selectedItems) schedule();
    });
    const offProject = useProjectStore.subscribe((state, previous) => {
      if (state.project !== previous.project) schedule();
    });

    return () => {
      retarget.cancel();
      offTimeline();
      offSelection();
      offProject();
      created.dispose();
      clearActiveEffectPreviewEngine(created);
      setEngine(null);
    };
  }, [setEngine, natural]);

  return null;
};

const subscribeNever = () => () => undefined;
const versionNever = () => 0;

const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function drawBitmap(canvas: HTMLCanvasElement | null, bitmap: ImageBitmap | null): boolean {
  if (!canvas || !bitmap) return false;
  try {
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(bitmap, 0, 0);
    return true;
  } catch {
    // The bitmap was evicted (closed) between the cache read and the draw: the next frame redraws.
    return false;
  }
}

/**
 * Real-footage preview of one effect card: the card's effect rendered by the
 * editor's own effect engines on the shared window of footage under the
 * playhead. A still poster at rest; while `active` (hover / keyboard focus) the
 * window loops with the effect applied. Decorative: hidden from assistive tech.
 */
export const EffectLivePreviewCard: React.FC<{ def: PreviewEffectDef; active: boolean }> = ({ def, active }) => {
  const engine = useContext(EffectPreviewContext);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  // Where the poster's footage came from: "sample" means the clip's own media could not be decoded.
  const [origin, setOrigin] = useState<string | null>(null);
  const version = useSyncExternalStore(
    engine ? engine.subscribe : subscribeNever,
    engine ? engine.getVersion : versionNever,
  );

  // Render posters only for cards that are in (or just next to) the viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !canvas || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin: "96px" },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [engine]);

  // Poster: the effect applied to the frame at the playhead. Re-requested when the source changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !visible || !canvas) return undefined;
    const abort = new AbortController();
    setFailed(false);
    // What is drawn is stale until this def's poster for the current footage lands: readers wait for "poster".
    canvas.dataset.previewState = "loading";
    void engine.renderPoster(def, abort.signal).then((bitmap) => {
      if (abort.signal.aborted) return;
      if (!bitmap) {
        // The renderer threw (not cancelled / superseded): say so instead of leaving a blank or stand-in card.
        if (engine.posterFailed(def)) {
          canvas.dataset.previewState = "error";
          setFailed(true);
        }
        return;
      }
      if (drawBitmap(canvas, bitmap)) {
        canvas.dataset.previewState = "poster";
        void engine.getWindow().then((window) => {
          if (!window || abort.signal.aborted) return;
          canvas.dataset.previewSource = window.origin;
          canvas.dataset.previewDef = def.id;
          canvas.dataset.previewTime = String(window.times[window.posterIndex] ?? 0);
          setOrigin(window.origin);
        });
      }
    });
    return () => abort.abort();
    // def identity is stable per card; version re-runs the effect when the footage changes.
  }, [engine, visible, version, def]);

  // Hover / focus: loop the window with the effect applied. Reduced motion keeps the poster.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!engine || !active || !visible || !canvas || prefersReducedMotion()) return undefined;
    const abort = new AbortController();
    let raf = 0;
    void engine.getWindow().then((window) => {
      // A looping card (motion, text ...) runs its own clock over the poster frame; the rest walk the footage window.
      const loop = def.loop;
      const count = loop ? loop.frames : window?.count ?? 0;
      const fps = loop ? loop.frames / loop.seconds : window?.fps ?? 0;
      if (!window || abort.signal.aborted || !(loop || window.animated)) return;
      const requested = new Set<number>();
      // Frames render a few ahead of the one on screen, never the whole window at once: sweeping the pointer
      // across cards queues almost nothing, and what hover does render lives in its own small cache.
      const ensureAhead = (from: number) => {
        for (let step = 0; step < HOVER_LOOKAHEAD_FRAMES; step++) {
          const index = (from + step) % count;
          if (requested.has(index) || engine.peek(def, index)) continue;
          requested.add(index);
          void engine.render(def, index, "hover", abort.signal).then((bitmap) => {
            if (!bitmap) requested.delete(index);
          });
        }
      };
      ensureAhead(0);
      const started = performance.now();
      let shown = -1;
      const tick = (now: number) => {
        if (abort.signal.aborted) return;
        const target = Math.floor(((now - started) / 1000) * fps) % count;
        ensureAhead(target);
        // Latest frame at or before the target that is already rendered: playback never waits on the renderer.
        let index = target;
        let bitmap: ImageBitmap | null = null;
        while (index >= 0 && !(bitmap = engine.peek(def, index))) index--;
        if (bitmap && index !== shown && drawBitmap(canvas, bitmap)) {
          shown = index;
          canvas.dataset.previewState = "playing";
          canvas.dataset.previewFrame = String(index);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      abort.abort();
      cancelAnimationFrame(raf);
      delete canvas.dataset.previewFrame;
      // Back to the poster. It lives in the engine's poster cache and may have been evicted or invalidated
      // meanwhile: re-request it rather than keep a bitmap that could have been closed.
      if (drawBitmap(canvas, engine.peekPoster(def))) {
        canvas.dataset.previewState = "poster";
      } else {
        const restore = new AbortController();
        void engine.renderPoster(def, restore.signal).then((bitmap) => {
          if (bitmap && !restore.signal.aborted && drawBitmap(canvas, bitmap)) canvas.dataset.previewState = "poster";
        });
      }
    };
  }, [engine, active, visible, version, def]);

  const note = failed ? null : previewNote(def);

  return (
    <div aria-hidden="true" className="absolute inset-0 bg-bg-2">
      <canvas
        ref={canvasRef}
        data-preview-state="loading"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center bg-bg-3 px-2 text-center text-[9px] text-fg-3">
          Preview unavailable
        </span>
      ) : null}
      {note || (origin === "sample" && !failed) ? (
        <div className="absolute left-1 top-1 flex flex-col items-start gap-0.5">
          {note ? (
            <span className="whitespace-nowrap rounded bg-black/55 px-1.5 py-0.5 text-[8px] uppercase text-white/85 backdrop-blur-sm">
              {note}
            </span>
          ) : null}
          {origin === "sample" && !failed ? (
            <span
              data-preview-badge="sample"
              title="Sample footage: this clip's own media could not be decoded"
              className="whitespace-nowrap rounded bg-black/55 px-1.5 py-0.5 text-[8px] uppercase text-white/85 backdrop-blur-sm"
            >
              Sample
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
