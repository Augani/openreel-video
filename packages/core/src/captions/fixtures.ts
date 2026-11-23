/**
 * Hand-built caption file fixtures shared by the importer tests. Nothing here is produced by the code under
 * test: the SCC / MCC words come from a separate script that follows CEA-608-E / SMPTE 334-2 byte for byte
 * (odd parity, doubled control codes, PAC tables), and the EBU-STL files are assembled field by field at the
 * Tech 3264 offsets.
 */

/** SCC, drop-frame, three captions (CC1 at row 2 indent 8, CC1 yellow bottom centre, CC2 text that must be reported). */
export const SCC_POSITIONED = [
  "Scenarist_SCC V1.0",
  "",
  // RCL RCL ENM ENM PAC(row 2, indent 8) "Left side" EOC EOC   -> EOC on pair 11
  "00:00:01;00\t9420 9420 94ae 94ae 91f4 91f4 4ce5 e6f4 2073 e964 e520 942f 942f",
  "",
  "00:00:03;00\t942c 942c",
  "",
  // RCL ENM PAC(row 15, indent 12) mid-row yellow "Yellow" EOC   -> EOC on pair 10
  "00:00:04;00\t9420 9420 94ae 94ae 9476 9476 912a d9e5 ecec eff7 942f 942f",
  "",
  "00:00:06;00\t942c 942c",
  "",
  // CC2: RCL ENM PAC(row 15) "Channel two" EOC
  "00:00:07;00\t1c20 1c20 1cae 1cae 1ce0 1ce0 4368 616e 6ee5 ec20 f4f7 ef20 1c2f 1c2f",
  "",
  "00:00:09;00\t1c2c 1c2c",
  "",
].join("\n");

/** MCC V2.0, 30 fps drop-frame: "Hello" on CC1 (row 15, indent 0), CC3 pairs on field 2 that must be reported. */
export const MCC_HELLO = [
  "File Format=MacCaption_MCC V2.0",
  "",
  "UUID=00000000-0000-0000-0000-000000000001",
  "Creation Program=OpenReel test fixture",
  "Time Code Rate=30DF",
  "",
  "00:00:00;00\tT49S494F43ZZ72F4FC9420FD1520OO74ZZD6AB",
  "00:00:00;01\tT49S494F43Z0172F4FC9420FD1520OO74Z01D4AB",
  "00:00:00;02\tT49S494F43Z0272F4FC94AEFD15AEOO74Z02B6AB",
  "00:00:00;03\tT49S494F43Z0372F4FC94AEFD15AEOO74Z03B4AB",
  "00:00:00;04\tT49S494F43Z0472F4FC94E0FD1540OO74Z04EEAB",
  "00:00:00;05\tT49S494F43Z0572F4FC94E0FD4FCBOO74Z0527AB",
  "00:00:00;06\tT49S494F43Z0672F4FCC8E5ROO74Z0606AB",
  "00:00:00;07\tT49S494F43Z0772F4FCECECROO74Z07D9AB",
  "00:00:00;08\tT49S494F43Z0872F4FCEF20ROO74Z08A0AB",
  "00:00:00;09\tT49S494F43Z0972F4FC942FROO74Z09EAAB",
  "00:00:00;10\tT49S494F43Z0A72F4FC942FROO74Z0AE8AB",
  "00:00:02;00\tT49S494F43Z0B72F4FC942CROO74Z0BE9AB",
  "00:00:02;01\tT49S494F43Z0C72F4FC942CROO74Z0CE7AB",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// EBU-STL (Tech 3264)

const put = (target: Uint8Array, at: number, text: string) => {
  for (let i = 0; i < text.length; i++) target[at + i] = text.charCodeAt(i);
};

export interface StlFixtureCue {
  start: [number, number, number, number];
  end: [number, number, number, number];
  vp: number;
  jc: number;
  /** Text field bytes (control codes included); padded with 0x8F. */
  tf: number[];
}

export function buildStlFixture(opts: { cct?: string; dsc?: string; mnr?: number; frameBase?: 25 | 30; cues: StlFixtureCue[] }): Uint8Array {
  const gsi = new Uint8Array(1024).fill(0x20);
  put(gsi, 0, "850");
  put(gsi, 3, opts.frameBase === 30 ? "STL30.01" : "STL25.01");
  put(gsi, 11, opts.dsc ?? "1");
  put(gsi, 12, opts.cct ?? "00");
  put(gsi, 14, "09");
  put(gsi, 16, "Fixture");
  put(gsi, 238, String(opts.cues.length).padStart(5, "0"));
  put(gsi, 243, String(opts.cues.length).padStart(5, "0"));
  put(gsi, 248, "001");
  put(gsi, 251, "40");
  put(gsi, 253, String(opts.mnr ?? 23).padStart(2, "0"));
  put(gsi, 255, "1");
  put(gsi, 256, "00000000");
  put(gsi, 264, "00000000");
  put(gsi, 272, "1");
  put(gsi, 273, "1");
  put(gsi, 274, "GBR");
  const out = new Uint8Array(1024 + opts.cues.length * 128);
  out.set(gsi, 0);
  opts.cues.forEach((c, i) => {
    const at = 1024 + i * 128;
    out[at] = 0;
    out[at + 1] = (i + 1) & 0xff; // SN, little endian
    out[at + 2] = (i + 1) >> 8;
    out[at + 3] = 0xff; // EBN: last (only) block
    out[at + 4] = 0; // CS: not cumulative
    out.set(c.start, at + 5);
    out.set(c.end, at + 9);
    out[at + 13] = c.vp;
    out[at + 14] = c.jc;
    out[at + 15] = 0; // CF
    out.fill(0x8f, at + 16, at + 128);
    c.tf.slice(0, 112).forEach((b, k) => (out[at + 16 + k] = b));
  });
  return out;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Teletext level 1, 25 fps: yellow text at the top left, a double-height two-liner at the bottom, right-justified text. */
export const STL_TELETEXT = buildStlFixture({
  cues: [
    { start: [0, 0, 1, 0], end: [0, 0, 3, 0], vp: 2, jc: 1, tf: [0x03, ...ascii("Top left")] },
    { start: [0, 0, 4, 0], end: [0, 0, 6, 12], vp: 20, jc: 2, tf: [0x0d, ...ascii("Line one"), 0x8a, ...ascii("Line two")] },
    { start: [0, 0, 7, 0], end: [0, 0, 9, 0], vp: 22, jc: 3, tf: [...ascii("Right "), 0x80, ...ascii("aligned"), 0x81] },
    { start: [0, 0, 10, 0], end: [0, 0, 12, 0], vp: 20, jc: 2, tf: [0x01, ...ascii("Red "), 0x02, ...ascii("then green")] },
  ],
});

/** Character code table 01 (ISO 8859-5 Cyrillic): "Привет". */
export const STL_CYRILLIC = buildStlFixture({
  cct: "01",
  cues: [{ start: [0, 0, 1, 0], end: [0, 0, 2, 0], vp: 20, jc: 2, tf: [0xbf, 0xe0, 0xd8, 0xd2, 0xd5, 0xe2] }],
});
