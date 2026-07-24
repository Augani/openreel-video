import type { BehaviorDef } from "../registry";
import { GLOW } from "./glow";
import { PARTICLES } from "./particles";
import { COLOR_TINT } from "./color-tint";
import { BLUR } from "./blur";
import { REPLACE } from "./replace";
import { DISTORT } from "./distort";
import { MASK_EDGE } from "./mask-edge";

export const ALL_ATOMICS: BehaviorDef[] = [GLOW, PARTICLES, COLOR_TINT, BLUR, REPLACE, DISTORT, MASK_EDGE];
