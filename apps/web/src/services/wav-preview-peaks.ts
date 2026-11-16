/** Read the actual PCM envelope from built-in WAV previews without decoding media. */
export function wavPreviewPeaks(buffer: ArrayBuffer, count = 72): number[] {
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
  return Array.from({ length: count }, (_, bin) => {
    let peak = 0;
    const from = Math.floor((bin * samples) / count),
      to = Math.floor(((bin + 1) * samples) / count);
    for (let i = from; i < to; i++)
      peak = Math.max(
        peak,
        Math.abs(view.getInt16(start + i * 2, true) / 32768),
      );
    return peak;
  });
}
