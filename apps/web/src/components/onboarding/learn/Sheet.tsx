import type { JSX } from "react";
import type { OnboardingSheetProps } from "../types";
import { LearnSheet } from "./LearnSheet";

/**
 * Entry point the host lazy-loads for openSheet "learn" (L1 footage picker) and "lessons" (Lesson Hub).
 * The sheet reads `openSheet` itself, so the host passes only `onClose`.
 */
export default function Sheet(props: OnboardingSheetProps): JSX.Element {
  return <LearnSheet {...props} />;
}
