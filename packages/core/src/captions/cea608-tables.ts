// CEA-608 character sets and parity helpers shared by the SCC encoder and the decoder.

export function withOddParity(byte: number): number {
  const b = byte & 0x7f;
  let p = b;
  p ^= p >> 4;
  p ^= p >> 2;
  p ^= p >> 1;
  return p & 1 ? b : b | 0x80;
}

export const hasOddParity = (byte: number): boolean => {
  let p = byte & 0xff;
  p ^= p >> 4;
  p ^= p >> 2;
  p ^= p >> 1;
  return (p & 1) === 1;
};

/** Basic set bytes that are not ASCII: byte -> character. */
export const BASIC_OVERRIDES: ReadonlyMap<number, string> = new Map([
  [0x2a, "á"], [0x5c, "é"], [0x5e, "í"], [0x5f, "ó"], [0x60, "ú"],
  [0x7b, "ç"], [0x7c, "÷"], [0x7d, "Ñ"], [0x7e, "ñ"], [0x7f, "█"],
]);

/** Special characters: 0x11, 0x30..0x3F. (0x39 is the transparent space.) */
export const SPECIAL = ["®", "°", "½", "¿", "™", "¢", "£", "♪", "à", " ", "è", "â", "ê", "î", "ô", "û"];

/** Extended sets: 0x12 (Spanish/French/misc) and 0x13 (Portuguese/German), 0x20..0x3F. */
export const EXTENDED_12 = [
  "Á", "É", "Ó", "Ú", "Ü", "ü", "‘", "¡", "*", "’", "—", "©", "℠", "•", "“", "”",
  "À", "Â", "Ç", "È", "Ê", "Ë", "ë", "Î", "Ï", "ï", "Ô", "Ù", "ù", "Û", "«", "»",
];
export const EXTENDED_13 = [
  "Ã", "ã", "Í", "Ì", "ì", "Ò", "ò", "Õ", "õ", "{", "}", "\\", "^", "_", "|", "~",
  "Ä", "ä", "Ö", "ö", "ß", "¥", "¤", "│", "Å", "å", "Ø", "ø", "┌", "┐", "└", "┘",
];

export const ROWS = 15;
export const COLS = 32;
export const PAC_FIRST_ROW: Record<number, number> = { 0x11: 1, 0x12: 3, 0x15: 5, 0x16: 7, 0x17: 9, 0x10: 11, 0x13: 12, 0x14: 14 };
