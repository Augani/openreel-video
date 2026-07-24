import type { Plugin } from "vite";

const FFMPEG_CORE_ASSET = /@ffmpeg\/core(-mt)?\/.*\.(wasm|js)(\?url)?$/;

export function isFfmpegCoreAsset(id: string): boolean {
  return FFMPEG_CORE_ASSET.test(id);
}

export function stripFfmpegPlugin(isDesktop: boolean): Plugin {
  return {
    name: "openreel-strip-ffmpeg",
    enforce: "pre",
    load(id: string): string | undefined {
      if (!isDesktop) return undefined;
      if (isFfmpegCoreAsset(id)) return 'export default "";';
      return undefined;
    },
  };
}
