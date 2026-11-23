/** Largest side of a luma-wipe map `readLumaMap` accepts. */
export const LUMA_MAX_SIDE = 256;

/** Base64 length of the largest accepted map (LUMA_MAX_SIDE x LUMA_MAX_SIDE bytes, padded): the cap on `lumaData`. */
export const LUMA_MAX_ENCODED_LENGTH = Math.ceil((LUMA_MAX_SIDE * LUMA_MAX_SIDE) / 3) * 4;
