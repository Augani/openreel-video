import { useCallback } from "react";
import { useRouter } from "../../../hooks/use-router";
import type { OnboardingSheetProps } from "../types";
import { CustomSequenceDialog } from "./CustomSequenceDialog";

/**
 * The Pro path's lazy sheet: the Custom sequence dialog, opened when the onboarding store's `openSheet`
 * is "custom-sequence". ProRow itself is inline in the welcome screen.
 */
export default function Sheet({ onClose }: OnboardingSheetProps) {
  const { navigate } = useRouter();
  const handleCreated = useCallback(() => {
    onClose();
    navigate("editor");
  }, [onClose, navigate]);
  return <CustomSequenceDialog onClose={onClose} onCreated={handleCreated} />;
}
