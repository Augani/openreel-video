import type { BehaviorDef } from "../registry";
import { FIRE_AURA } from "./fire-aura.v1";
import { SPARKLES_FACE } from "./sparkles.face.v1";
import { GHOST_TRAIL } from "./ghost-trail.v1";
import { CLONE_THREE } from "./clone.three.v1";
import { AURA_GLOW } from "./aura-glow.v1";
import { BACKGROUND_REPLACE } from "./background-replace.v1";
import { FACE_TINT } from "./face-tint.v1";
import { WARM_LOOK } from "./warm-look.v1";
import { CINEMATIC_BARS } from "./cinematic-bars.v1";
import { DREAMY } from "./dreamy.v1";

export const ALL_PRESETS: BehaviorDef[] = [
  FIRE_AURA, SPARKLES_FACE, GHOST_TRAIL, CLONE_THREE, AURA_GLOW,
  BACKGROUND_REPLACE, FACE_TINT, WARM_LOOK, CINEMATIC_BARS, DREAMY,
];
