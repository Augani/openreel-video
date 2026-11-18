interface Box { type: string; bytes: Uint8Array }
const decoder = new TextDecoder();

function children(bytes: Uint8Array): Box[] {
  const boxes: Box[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error("Incomplete MP4 timing metadata.");
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > bytes.length) throw new Error("Invalid MP4 timing metadata.");
    boxes.push({ type: decoder.decode(bytes.subarray(offset + 4, offset + 8)), bytes: bytes.slice(offset, offset + size) });
    offset += size;
  }
  return boxes;
}

function box(type: string, payloads: Uint8Array[]): Uint8Array {
  const size = 8 + payloads.reduce((total, bytes) => total + bytes.length, 0);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(new TextEncoder().encode(type), 4);
  let offset = 8;
  for (const payload of payloads) { bytes.set(payload, offset); offset += payload.length; }
  return bytes;
}

function view(bytes: Uint8Array): DataView { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function timescale(header: Uint8Array): number { return view(header).getUint32(header[8] === 1 ? 28 : 20); }
function duration(header: Uint8Array, track = false): number {
  const offset = track ? (header[8] === 1 ? 36 : 28) : (header[8] === 1 ? 32 : 24);
  return header[8] === 1 ? Number(view(header).getBigUint64(offset)) : view(header).getUint32(offset);
}
function setDuration(header: Uint8Array, value: number, track = false): void {
  const offset = track ? (header[8] === 1 ? 36 : 28) : (header[8] === 1 ? 32 : 24);
  if (header[8] === 1) view(header).setBigUint64(offset, BigInt(value));
  else {
    if (value > 0xffffffff) throw new Error("MP4 duration exceeds the timing header capacity.");
    view(header).setUint32(offset, value);
  }
}

/** Preserve all encoded samples and offsets; tell players to skip measured AAC priming and end padding. */
export function applyMp4AudioTiming(moov: Uint8Array, primingSamples: number, sampleRate: number, audioFrames: number): Uint8Array {
  if (![primingSamples, audioFrames].every((value) => Number.isSafeInteger(value) && value >= 0) || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("Invalid audio timing.");
  const movieChildren = children(moov);
  const movieHeader = movieChildren.find((child) => child.type === "mvhd");
  if (!movieHeader) throw new Error("MP4 movie timing header is missing.");
  const movieScale = timescale(movieHeader.bytes);
  let audioTracks = 0;
  for (const track of movieChildren.filter((child) => child.type === "trak")) {
    const trackChildren = children(track.bytes);
    const media = trackChildren.find((child) => child.type === "mdia");
    if (!media) continue;
    const mediaChildren = children(media.bytes);
    const handler = mediaChildren.find((child) => child.type === "hdlr");
    if (!handler || decoder.decode(handler.bytes.subarray(16, 20)) !== "soun") continue;
    if (trackChildren.some((child) => child.type === "edts")) throw new Error("MP4 audio already contains an edit list.");
    const mediaHeader = mediaChildren.find((child) => child.type === "mdhd");
    const trackHeader = trackChildren.find((child) => child.type === "tkhd");
    if (!mediaHeader || !trackHeader) throw new Error("MP4 audio timing header is missing.");
    const segmentDuration = Math.round(audioFrames / sampleRate * movieScale);
    const mediaStart = Math.round(primingSamples / sampleRate * timescale(mediaHeader.bytes));
    const edit = new Uint8Array(28);
    const editView = view(edit);
    edit[0] = 1; // version 1 supports long recordings
    editView.setUint32(4, 1);
    editView.setBigUint64(8, BigInt(segmentDuration));
    editView.setBigInt64(16, BigInt(mediaStart));
    editView.setInt16(24, 1); // media rate 1.0
    setDuration(trackHeader.bytes, segmentDuration, true);
    track.bytes = box("trak", [...trackChildren.map((child) => child.bytes), box("edts", [box("elst", [edit])])]);
    audioTracks++;
  }
  if (audioTracks !== 1) throw new Error("Expected one mixed audio track in the MP4 export.");
  const movieDuration = Math.max(...movieChildren.filter((child) => child.type === "trak").map((track) => {
    const header = children(track.bytes).find((child) => child.type === "tkhd");
    if (!header) throw new Error("MP4 track timing header is missing.");
    return duration(header.bytes, true);
  }));
  setDuration(movieHeader.bytes, movieDuration);
  return box("moov", movieChildren.map((child) => child.bytes));
}

function rebuildChild(parent: Uint8Array, type: string, change: (child: Uint8Array) => Uint8Array): Uint8Array {
  const kind = decoder.decode(parent.subarray(4, 8));
  return box(kind, children(parent).map((child) => (child.type === type ? change(child.bytes) : child.bytes)));
}

/** Apple `chan` atom: version/flags, layout tag, empty channel bitmap, no channel descriptions. */
export function channelLayoutAtom(layoutTag: number): Uint8Array {
  const payload = new Uint8Array(16);
  new DataView(payload.buffer).setUint32(4, layoutTag >>> 0);
  return box("chan", [payload]);
}

/**
 * Adds the `chan` (channel layout) atom to the audio sample entry of a QuickTime
 * movie so players read the speaker layout (e.g. L R C LFE Ls Rs) instead of
 * guessing it from the channel count. Encoded samples and offsets are untouched:
 * like `applyMp4AudioTiming` only the (trailing) moov grows.
 */
export function applyMovChannelLayout(moov: Uint8Array, layoutTag: number): Uint8Array {
  const atom = channelLayoutAtom(layoutTag);
  let changed = 0;
  const movieChildren = children(moov).map((track) => {
    if (track.type !== "trak") return track.bytes;
    const media = children(track.bytes).find((child) => child.type === "mdia");
    const handler = media && children(media.bytes).find((child) => child.type === "hdlr");
    if (!handler || decoder.decode(handler.bytes.subarray(16, 20)) !== "soun") return track.bytes;
    const addToStsd = (stsd: Uint8Array): Uint8Array => {
      const head = stsd.slice(8, 16); // version/flags + entry count
      const entries: Uint8Array[] = [];
      for (let offset = 16; offset < stsd.length;) {
        const size = view(stsd).getUint32(offset);
        if (size < 8 || offset + size > stsd.length) throw new Error("Invalid MP4 sample description.");
        const entry = stsd.slice(offset, offset + size);
        entries.push(box(decoder.decode(entry.subarray(4, 8)), [entry.subarray(8), atom]));
        offset += size;
      }
      changed++;
      return box("stsd", [head, ...entries]);
    };
    const inStbl = (stbl: Uint8Array) => rebuildChild(stbl, "stsd", addToStsd);
    const inMinf = (minf: Uint8Array) => rebuildChild(minf, "stbl", inStbl);
    const inMdia = (mdia: Uint8Array) => rebuildChild(mdia, "minf", inMinf);
    return rebuildChild(track.bytes, "mdia", inMdia);
  });
  if (changed === 0) throw new Error("No audio sample description to tag with a channel layout.");
  return box("moov", movieChildren);
}
