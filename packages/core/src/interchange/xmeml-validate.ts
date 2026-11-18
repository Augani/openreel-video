import { child, childNumber, childText, childrenNamed, parseXml, type XmlElement } from "./xml";

/**
 * Structural validation of Final Cut Pro 7 XML (xmeml v5) for the elements
 * Premiere Pro and DaVinci Resolve require. xmeml has no machine-readable
 * public schema, so this encodes the contract those importers rely on:
 * sequence > rate/timecode/media; media > video|audio > track > clipitem |
 * transitionitem; every clipitem carries name/duration/rate/start/end/in/out
 * and a file with rate, duration, timecode and media; links and file ids
 * resolve. Returns human-readable problems; an empty list means valid.
 */

export function validateXmeml(source: string): string[] {
  const problems: string[] = [];
  const bad = (where: string, message: string): void => {
    problems.push(`${where}: ${message}`);
  };
  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (e) {
    return [`not well-formed XML: ${(e as Error).message}`];
  }
  if (root.name !== "xmeml") return ["root element must be <xmeml>"];
  if (root.attrs.version !== "5") bad("xmeml", `version must be "5" (got "${root.attrs.version ?? ""}")`);

  const requireRate = (el: XmlElement | undefined, where: string): void => {
    const rate = child(el, "rate");
    if (!rate) return bad(where, "missing <rate>");
    const tb = childNumber(rate, "timebase");
    if (!tb || tb <= 0 || !Number.isInteger(tb)) bad(where, "<rate><timebase> must be a positive integer");
    const ntsc = childText(rate, "ntsc");
    if (ntsc !== "TRUE" && ntsc !== "FALSE") bad(where, "<rate><ntsc> must be TRUE or FALSE");
  };
  const requireNumber = (el: XmlElement, name: string, where: string): number | undefined => {
    const v = childNumber(el, name);
    if (v === undefined) bad(where, `missing or non-numeric <${name}>`);
    return v;
  };
  const requireText = (el: XmlElement, name: string, where: string): void => {
    if (childText(el, name) === undefined) bad(where, `missing <${name}>`);
  };
  const requireTimecode = (el: XmlElement | undefined, where: string): void => {
    if (!el) return bad(where, "missing <timecode>");
    requireRate(el, `${where}/timecode`);
    requireText(el, "string", `${where}/timecode`);
    requireNumber(el, "frame", `${where}/timecode`);
    const df = childText(el, "displayformat");
    if (df !== "DF" && df !== "NDF") bad(`${where}/timecode`, "<displayformat> must be DF or NDF");
  };

  const sequences = childrenNamed(root, "sequence");
  if (sequences.length === 0) return [...problems, "xmeml must contain a <sequence>"];
  const clipIds = new Map<string, { kind: "video" | "audio"; track: number; index: number }>();
  const definedFiles = new Set<string>();
  const fileRefs: { id: string; where: string }[] = [];
  const definedSequences = new Set<string>(sequences[0]?.attrs.id ? [sequences[0].attrs.id] : []);
  const sequenceRefs: { id: string; where: string }[] = [];
  const links: { ref: string; where: string; mediatype: string; track: number; index: number }[] = [];

  const checkFile = (file: XmlElement | undefined, where: string): void => {
    if (!file) return bad(where, "missing <file>");
    const id = file.attrs.id;
    if (!id) return bad(where, "<file> needs an id attribute");
    const isFull = file.children.length > 0;
    if (!isFull) {
      fileRefs.push({ id, where });
      return;
    }
    if (definedFiles.has(id)) bad(where, `file "${id}" is defined in full more than once`);
    definedFiles.add(id);
    requireText(file, "name", `${where}/file`);
    requireRate(file, `${where}/file`);
    requireNumber(file, "duration", `${where}/file`);
    requireTimecode(child(file, "timecode"), `${where}/file`);
    const fm = child(file, "media");
    if (!fm) bad(`${where}/file`, "missing <media>");
    else if (!child(fm, "video") && !child(fm, "audio")) bad(`${where}/file/media`, "needs <video> and/or <audio>");
  };

  /** A multicam cut: every angle names a file, exactly one is the active picture, and it is the clipitem's own file. */
  const checkMulticlip = (multiclip: XmlElement, clipFileId: string | undefined, where: string): void => {
    if (!multiclip.attrs.id) bad(where, "<multiclip> needs an id attribute");
    requireText(multiclip, "name", where);
    const angles = childrenNamed(multiclip, "angle");
    if (angles.length < 2) bad(where, "a multiclip needs at least two <angle> elements");
    let active = 0;
    angles.forEach((angle, i) => {
      const aw = `${where}/angle[${i + 1}]`;
      if (!angle.attrs.id) bad(aw, "<angle> needs an id attribute");
      requireText(angle, "name", aw);
      const flag = childText(angle, "activevideo");
      if (flag !== "TRUE" && flag !== "FALSE") bad(aw, "<activevideo> must be TRUE or FALSE");
      checkFile(child(angle, "file"), aw);
      if (flag === "TRUE") {
        active++;
        if (child(angle, "file")?.attrs.id !== clipFileId) bad(aw, "the active angle's file must be the clipitem's file");
      }
    });
    if (angles.length > 0 && active !== 1) bad(where, "exactly one angle must be the active video angle");
  };

  const checkTracks = (parent: XmlElement | undefined, kind: "video" | "audio"): void => {
    if (!parent) return;
    childrenNamed(parent, "track").forEach((track, ti) => {
      const tw = `${kind}/track[${ti + 1}]`;
      const enabled = childText(track, "enabled");
      const locked = childText(track, "locked");
      if (enabled !== undefined && enabled !== "TRUE" && enabled !== "FALSE") bad(tw, "<enabled> must be TRUE or FALSE");
      if (locked !== undefined && locked !== "TRUE" && locked !== "FALSE") bad(tw, "<locked> must be TRUE or FALSE");
      const t = track.attrs["MZ.TrackTargeted"];
      if (t !== undefined && t !== "0" && t !== "1") bad(tw, "MZ.TrackTargeted must be 0 or 1");
      let ci = 0;
      for (const el of track.children) {
        if (el.name === "clipitem") {
          ci++;
          const cw = `${tw}/clipitem[${ci}]`;
          const id = el.attrs.id;
          if (!id) bad(cw, "missing id attribute");
          else if (clipIds.has(id)) bad(cw, `duplicate clipitem id "${id}"`);
          else clipIds.set(id, { kind, track: ti + 1, index: ci });
          requireText(el, "name", cw);
          requireNumber(el, "duration", cw);
          requireRate(el, cw);
          const start = requireNumber(el, "start", cw);
          const end = requireNumber(el, "end", cw);
          const inF = requireNumber(el, "in", cw);
          const outF = requireNumber(el, "out", cw);
          if (start !== undefined && end !== undefined && start >= 0 && end >= 0 && end <= start) bad(cw, "<end> must be after <start>");
          if (inF !== undefined && outF !== undefined && outF < inF) bad(cw, "<out> must not be before <in>");
          if (kind === "audio" && !child(el, "sourcetrack")) bad(cw, "audio clipitem needs <sourcetrack>");
          const nestedSequence = child(el, "sequence");
          if (nestedSequence) {
            // A nest: a full nested <sequence> (validated in turn) or a reference to one by id.
            if (nestedSequence.children.length > 0) {
              if (nestedSequence.attrs.id) definedSequences.add(nestedSequence.attrs.id);
              checkSequence(nestedSequence, `${cw}/sequence`);
            } else if (nestedSequence.attrs.id) {
              sequenceRefs.push({ id: nestedSequence.attrs.id, where: cw });
            } else bad(cw, "<sequence> reference needs an id attribute");
          } else {
            checkFile(child(el, "file"), cw);
            const multiclip = child(el, "multiclip");
            if (multiclip) checkMulticlip(multiclip, child(el, "file")?.attrs.id, `${cw}/multiclip`);
          }
          for (const [li, l] of childrenNamed(el, "link").entries()) {
            const ref = childText(l, "linkclipref");
            if (!ref) bad(`${cw}/link[${li + 1}]`, "missing <linkclipref>");
            else {
              links.push({
                ref,
                where: `${cw}/link[${li + 1}]`,
                mediatype: childText(l, "mediatype") ?? "",
                track: childNumber(l, "trackindex") ?? 0,
                index: childNumber(l, "clipindex") ?? 0,
              });
            }
          }
        } else if (el.name === "transitionitem") {
          const xw = `${tw}/transitionitem`;
          const start = requireNumber(el, "start", xw);
          const end = requireNumber(el, "end", xw);
          if (start !== undefined && end !== undefined && end <= start) bad(xw, "<end> must be after <start>");
          requireText(el, "alignment", xw);
          requireRate(el, xw);
          const fx = child(el, "effect");
          if (!fx) bad(xw, "missing <effect>");
          else {
            requireText(fx, "name", `${xw}/effect`);
            requireText(fx, "effectid", `${xw}/effect`);
            if (childText(fx, "effecttype") !== "transition") bad(`${xw}/effect`, '<effecttype> must be "transition"');
          }
        } else if (el.name !== "enabled" && el.name !== "locked") {
          bad(tw, `unexpected element <${el.name}>`);
        }
      }
    });
  };
  const checkSequence = (sequence: XmlElement, where: string): void => {
  requireText(sequence, "name", where);
  requireNumber(sequence, "duration", where);
  requireRate(sequence, where);
  requireTimecode(child(sequence, "timecode"), where);
  for (const [i, m] of childrenNamed(sequence, "marker").entries()) {
    requireText(m, "name", `${where}/marker[${i}]`);
    requireNumber(m, "in", `${where}/marker[${i}]`);
  }
  const media = child(sequence, "media");
  if (!media) return bad(where, "missing <media>");

  const video = child(media, "video");
  const audio = child(media, "audio");
  if (!video && !audio) bad(`${where}/media`, "needs <video> and/or <audio>");
  if (video) {
    const sc = child(child(video, "format"), "samplecharacteristics");
    if (!sc) bad("video", "missing <format><samplecharacteristics>");
    else {
      requireRate(sc, "video/format/samplecharacteristics");
      requireNumber(sc, "width", "video/format/samplecharacteristics");
      requireNumber(sc, "height", "video/format/samplecharacteristics");
    }
  }
  if (audio) {
    const sc = child(child(audio, "format"), "samplecharacteristics");
    if (!sc) bad("audio", "missing <format><samplecharacteristics>");
    else {
      requireNumber(sc, "depth", "audio/format/samplecharacteristics");
      requireNumber(sc, "samplerate", "audio/format/samplecharacteristics");
    }
  }

  checkTracks(video, "video");
  checkTracks(audio, "audio");

  };
  checkSequence(sequences[0], "sequence");
  for (const r of sequenceRefs) if (!definedSequences.has(r.id)) bad(r.where, `<sequence id="${r.id}"/> is referenced but never defined in full`);
  for (const f of fileRefs) if (!definedFiles.has(f.id)) bad(f.where, `<file id="${f.id}"/> is referenced but never defined in full`);
  for (const l of links) {
    const target = clipIds.get(l.ref);
    if (!target) bad(l.where, `links to unknown clipitem "${l.ref}"`);
    else if (target.kind !== l.mediatype || target.track !== l.track || target.index !== l.index) {
      bad(l.where, `link coordinates (${l.mediatype} t${l.track} c${l.index}) do not match clipitem "${l.ref}"`);
    }
  }
  return problems;
}
