import { readEmbeddedXmpPacket, xmpFieldsFromPackets, xmpFieldsToMediaFields } from "@openreel/core";
import { nativePathForFile } from "./native-path";
import { setMediaMetadata } from "./media-metadata-commands";

/**
 * Logging metadata that arrives with a file: embedded XMP (MP4/MOV `uuid` / `XMP_` box, JPEG APP1) and,
 * on desktop, the sidecar `.xmp` beside it. Applied to the imported item as one undo step. Best effort:
 * a file without XMP (the usual case) changes nothing.
 */
export async function applyImportedXmp(mediaId: string, file: File): Promise<void> {
  try {
    const path = nativePathForFile(file);
    const bridge = typeof window === "undefined" ? undefined : window.openreel?.mediaBrowser;
    if (path && bridge) {
      const xmp = await bridge.readXmp(path);
      if (xmp) await setMediaMetadata([mediaId], { ...xmpFieldsToMediaFields(xmp.fields), xmpSource: xmp.source, sourcePath: path }, "Import metadata");
      return;
    }
    const packet = await readEmbeddedXmpPacket(file.name, { size: file.size, read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) });
    const fields = xmpFieldsFromPackets(packet, null);
    if (fields) await setMediaMetadata([mediaId], { ...xmpFieldsToMediaFields(fields), xmpSource: "embedded" }, "Import metadata");
  } catch {
    // Unreadable XMP never blocks an import.
  }
}
