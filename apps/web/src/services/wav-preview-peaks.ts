/** Read the actual PCM envelope from built-in WAV previews without decoding media. */
export function wavPreviewPeaks(
  buffer: ArrayBuffer,
  count = 72,
  mode: "peak" | "rms" = "peak",
): number[] {
  const view = new DataView(buffer);
  if (view.byteLength < 44) return [];
  const text = (offset: number) =>
    String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (text(0) !== "RIFF" || text(8) !== "WAVE") return [];
  let format = 0,
    bits = 0,
    start = 0,
    length = 0;
  for (let offset = 12; offset + 8 <= view.byteLength; ) {
    const kind = text(offset),
      size = view.getUint32(offset + 4, true),
      data = offset + 8;
    if (data + size > view.byteLength) return [];
    if (kind === "fmt " && size >= 16) {
      format = view.getUint16(data, true);
      bits = view.getUint16(data + 14, true);
    }
    if (kind === "data") {
      start = data;
      length = size;
      break;
    }
    offset = data + size + (size % 2);
  }
  if (
    !start ||
    format !== 1 ||
    bits !== 16 ||
    !Number.isInteger(count) ||
    count < 1
  )
    return [];
  const samples = Math.floor(length / 2);
  const bins = Array.from({ length: count }, (_, bin) => {
    let peak = 0,
      energy = 0;
    const from = Math.floor((bin * samples) / count),
      to = Math.floor(((bin + 1) * samples) / count);
    for (let i = from; i < to; i++) {
      const value = Math.abs(view.getInt16(start + i * 2, true) / 32768);
      peak = Math.max(peak, value);
      energy += value * value;
    }
    return mode === "rms" ? Math.sqrt(energy / Math.max(1, to - from)) : peak;
  });
  return bins;
}

/**
 * Loudness envelope of a built-in WAV, normalised to its own loudest bin. A
 * per-bin peak reads near 1.0 for every drum loop; RMS keeps the sections,
 * builds and drops that actually differ between tracks.
 */
export function wavPreviewEnvelope(buffer: ArrayBuffer, count = 60): number[] {
  const rms = wavPreviewPeaks(buffer, count, "rms");
  // Light 3-tap smoothing turns drum hits into the loudness shape of the section.
  const smooth = rms.map((value, i) =>
    (rms[Math.max(0, i - 1)] + 2 * value + rms[Math.min(rms.length - 1, i + 1)]) / 4,
  );
  const max = Math.max(0, ...smooth);
  const min = Math.min(max, ...smooth);
  if (max <= 0) return smooth;
  // Stretch between this sound's quietest and loudest bar so rows read differently.
  return smooth.map((value) => (max === min ? 1 : 0.12 + (0.88 * (value - min)) / (max - min)));
}
