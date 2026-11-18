/**
 * AAF (Advanced Authoring Format) is exported and imported as an edit-only file: a composition
 * with video and audio tracks that references external media by path and name. The container is
 * written by `./aaf/` (a CFB writer plus the AAF object layer). The features AAF does not carry
 * here are listed in AAF_LIMITS and in docs/interchange.md.
 */
export const AAF_DECISION = {
  summary: "AAF is available.",
  detail:
    "File > Export timeline > AAF writes a composition (clips, speed, dissolves, levels, markers, timecode) that references the media files by path; effects, nested sequences and embedded media are not carried. See docs/interchange.md.",
} as const;

/** What an AAF file from this editor does not carry. Shown in the AAF export report. */
export const AAF_LIMITS: readonly string[] = [
  "Effects, colour, keyframes, titles and graphics are not written; AAF effect parameters are not interoperable between hosts.",
  "Nested sequences are expanded in place; multicam clips become plain clips of the active angle.",
  "Media is never embedded. The file references your media files by path and name, so relink them in the other editor if the paths differ.",
  "Audio retiming, fades, pan and level automation are not written; only a constant clip level and a constant track level are.",
  "Written with the pyaaf2-compatible dictionary and checked with pyaaf2; it has not been opened in Avid Media Composer, Premiere Pro or DaVinci Resolve.",
];

/** The informational line every non-AAF export report carries. */
export const aafNote = (): string => `${AAF_DECISION.summary} ${AAF_DECISION.detail}`;
