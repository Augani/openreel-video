# Parallel segment export (desktop)

A long export is cut at frame boundaries into segments, hidden worker windows render the segments at the same time through
the ordinary native encode path (`ExportJob` on the ffmpeg sidecar), and the pieces are stream-copied together with one
audio track. It runs from the export queue; the editor window renders nothing, so it stays free for editing while a job runs.

| Piece | Where |
| --- | --- |
| Plan (pure): clip-edge cut points, no cut inside a render-history effect, worker count from cores and memory | `packages/core/src/export/segment-plan.ts` |
| One frame window of the export (`segmentWindow`: video frames `[start, end)` at absolute times, or audio only) | `ExportEngine.exportVideo` |
| Orchestrator in the editor window; falls back to the serial export when the plan does not apply | `apps/web/src/services/export-queue/parallel-segment-export.ts` |
| Hidden worker windows (`#/export-segment-worker/<session>/<video|audio>`), project read from the queue snapshot in IndexedDB | `apps/web/src/services/export-queue/segment-worker.ts`, `apps/desktop/src/main/ipc/segment-export.ts` |
| Segment encode (`-an`, MPEG-TS / MOV, closed GOP, timestamps on the frame grid) and the join | `sidecar/segment-args.ts`, `sidecar/segment-session.ts` |

## When it applies

H.264 / H.265 (MP4, MOV) and ProRes 422 (MOV), native (ffmpeg) encode, at least 12 s, no preview-cache frames, smart render
off or not applicable, no two-pass, HDR / 10-bit, alpha, broadcast, embedded captions or AI upscaling. Anything else exports as
one stream exactly as before. `parallelSegments: "off"` turns it off. The memory governor and RAM cap the worker count (at most
4, at most 2 on a hardware encoder); with no room for one worker the export stays one stream.

## What is guaranteed

* Boundaries depend only on the project and the settings, never on the machine, so running the plan one segment at a time
  gives the same file as running it on 4 workers.
* Every segment is checked to hold exactly its frames (ffmpeg's frame count against the plan) and the plan is checked to tile the
  export with no gap or overlap; the join refuses otherwise.
* The audio is rendered once for the whole timeline and muxed once: there is no seam.
* ProRes (intra-only) is byte-identical to the single-stream export. H.264 / H.265 segments restart the encoder at every
  boundary, so decoded frames equal the single-stream encode only up to rate-control state (about 48 dB PSNR on a noisy test
  pattern; the frame count, timing and every cut are exact).
