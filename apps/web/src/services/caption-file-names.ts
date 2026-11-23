/** Caption file extensions the Project panel routes to the caption importer (kept tiny: the panel needs it synchronously). */
const CAPTION_FILE = /\.(srt|vtt|sbv|ttml|dfxp|itt|scc|mcc|stl)$/i;

export const isCaptionFileName = (name: string): boolean => CAPTION_FILE.test(name);
