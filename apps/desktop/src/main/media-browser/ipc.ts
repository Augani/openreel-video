import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CHANNELS } from "../../shared/channels";
import {
  mediaBrowserClipArgsSchema,
  mediaBrowserFilmstripArgsSchema,
  mediaBrowserListArgsSchema,
  mediaBrowserReadXmpArgsSchema,
  mediaBrowserThumbnailArgsSchema,
  mediaBrowserWriteSidecarArgsSchema,
} from "../../shared/ipc-contract";
import { handle } from "../ipc";
import { resolveFfmpegPath } from "../sidecar/ffmpeg-path";
import { listDirectory, listPlaces } from "./browse";
import { buildPreview, filmstripOf, prepareClipFile, probeClip, thumbnailOf, type ToolContext } from "./tools";
import { readXmpOfFile, writeSidecarFor } from "./xmp-io";

function context(): ToolContext {
  return { ffmpegPath: resolveFfmpegPath(), cacheDir: path.join(app.getPath("userData"), "media-browser") };
}

export function registerMediaBrowserIpc(): void {
  handle(CHANNELS.mediaBrowserPlaces, z.undefined(), () => listPlaces());
  handle(CHANNELS.mediaBrowserList, mediaBrowserListArgsSchema, (args) => listDirectory(args.path, { rawFolders: args.rawFolders }));
  handle(CHANNELS.mediaBrowserThumbnail, mediaBrowserThumbnailArgsSchema, (args) => thumbnailOf(context(), args.path, args.time ?? 1, args.width ?? 320));
  handle(CHANNELS.mediaBrowserFilmstrip, mediaBrowserFilmstripArgsSchema, (args) => filmstripOf(context(), args.clip, args.count ?? 10, args.width ?? 240));
  handle(CHANNELS.mediaBrowserProbeClip, mediaBrowserClipArgsSchema, (args) => probeClip(context(), args.clip));
  handle(CHANNELS.mediaBrowserPreview, mediaBrowserClipArgsSchema, async (args) => {
    const preview = await buildPreview(context(), args.clip);
    const buf = await fs.readFile(preview.path);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, duration: preview.duration, truncated: preview.truncated };
  });
  handle(CHANNELS.mediaBrowserPrepareImport, mediaBrowserClipArgsSchema, (args) => prepareClipFile(context(), args.clip));
  handle(CHANNELS.mediaBrowserReadXmp, mediaBrowserReadXmpArgsSchema, (args) => readXmpOfFile(args.path));
  handle(CHANNELS.mediaBrowserWriteSidecar, mediaBrowserWriteSidecarArgsSchema, async (args) => ({ path: await writeSidecarFor(args.path, args.fields) }));
}
