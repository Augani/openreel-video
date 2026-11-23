import { acesToHdr1000Xyz, acesToSdrXyz } from "../aces-output";
import { registerAnalytic } from "./ops";

/**
 * The ACES 1.x output transforms OCIO ships as BuiltinTransforms, evaluated with the RRT / ODT port of
 * `color/aces-output.ts` (checked against OpenColorIO in `aces.test.ts`). They return CIE XYZ (D65) with 1.0 = 100 nit, the
 * connection space of OCIO's display colour spaces, so the config's own DISPLAY builtin finishes the job.
 *
 * Kept in a module of its own: it pulls in the RRT / ODT tables, and only configs that use these builtins need them.
 */

let registered = false;

export function registerAcesOutputBuiltins(): void {
  if (registered) return;
  registered = true;
  const tmp = [0, 0, 0];
  registerAnalytic("aces13_sdr_video", (c) => {
    acesToSdrXyz(c[0], c[1], c[2], tmp);
    c[0] = tmp[0];
    c[1] = tmp[1];
    c[2] = tmp[2];
  });
  registerAnalytic("aces13_hdr_1000_rec2020", (c) => {
    // XYZ D65 with 1.0 = the 1000 nit peak; OCIO's display connection space has 1.0 = 100 nit.
    acesToHdr1000Xyz(c[0], c[1], c[2], tmp);
    c[0] = tmp[0] * 10;
    c[1] = tmp[1] * 10;
    c[2] = tmp[2] * 10;
  });
}
