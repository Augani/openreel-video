export function containWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export async function decodeVideoBackdrop(blob: Blob, time: number, max: number): Promise<ImageBitmap | null> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const size = containWithin(track.displayWidth, track.displayHeight, max);
    const sink = new CanvasSink(track, { width: size.width, height: size.height, fit: "fill", poolSize: 1 });
    const wrapped = await sink.getCanvas(time);
    if (!wrapped) return null;
    return await createImageBitmap(wrapped.canvas);
  } finally {
    input[Symbol.dispose]?.();
  }
}
