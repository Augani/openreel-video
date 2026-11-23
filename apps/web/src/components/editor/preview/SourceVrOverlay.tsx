import React, { useCallback, useRef } from "react";
import { effectiveVrProperties, isVrProperties, type MediaItem } from "@openreel/core";
import { useSourceVrViewStore } from "../../../stores/vr-view-store";
import { VrView } from "./VrMonitorOverlay";

/** Widest frame the Source monitor's VR view reads (the monitor never needs more than screen resolution). */
const MAX_SOURCE_WIDTH = 2048;

/**
 * Source monitor VR video view: the same rectilinear window (drag, scroll, reset) as the Program monitor's, looking
 * into the loaded clip's equirectangular frame. The clip's VR Properties (its metadata or the user's override) say how
 * to read it. View only: nothing here reaches the project, an edit or an export.
 */
export const SourceVrOverlay: React.FC<{ media: MediaItem; getElement: () => HTMLVideoElement | HTMLImageElement | null }> = ({ media, getElement }) => {
  const enabled = useSourceVrViewStore((state) => state.enabled);
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const getSource = useCallback((): HTMLCanvasElement | null => {
    const el = getElement();
    if (!el) return null;
    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !h || (el instanceof HTMLVideoElement && el.readyState < 2)) return null;
    const scale = Math.min(1, MAX_SOURCE_WIDTH / w);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = (scratch.current ??= document.createElement("canvas"));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    canvas.getContext("2d")?.drawImage(el, 0, 0, cw, ch);
    return canvas;
  }, [getElement]);

  const vr = effectiveVrProperties(media);
  if (!enabled || !isVrProperties(vr)) return null;
  return <VrView layout={vr.layout} getSource={getSource} store={useSourceVrViewStore} idPrefix="source-vr" label="source" />;
};
