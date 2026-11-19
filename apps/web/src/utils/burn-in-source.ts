import { createBurnInSource, type BurnInSource } from "@openreel/core";
import { useProjectStore } from "../stores/project-store";

/**
 * Burn-in source of the project being edited (cached per project object by the core, so this is a pointer lookup
 * once a frame). Preview, playback and effect cards read names and timecodes through it; export builds its own
 * from the project it was handed.
 */
export const currentBurnInSource = (): BurnInSource => createBurnInSource(useProjectStore.getState().project);
