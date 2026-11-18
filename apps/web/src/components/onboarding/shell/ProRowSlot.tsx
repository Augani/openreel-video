import { useCallback } from "react";
import { ProRow } from "../pro/ProRow";
import { withUserProjectCreation } from "./project-intent";

/**
 * The inline "I already edit" row (spec 2.3), lazy-loaded by PathBand so keyboard-shortcuts and the
 * project services stay out of the eager welcome chunk. The row itself lives in the pro package.
 */

interface ProRowSlotProps {
  /** Move focus to the first chip when the row opens. */
  autoFocus?: boolean;
}

export function ProRowSlot({ autoFocus = true }: ProRowSlotProps) {
  const openEditor = useCallback(() => {
    // The user chose to go to the editor from this row: never attribute it to an agent.
    void withUserProjectCreation(async () => {
      window.location.hash = "#/editor";
      return true;
    });
  }, []);

  return (
    <div id="onboarding-pro-row" data-testid="onboarding-pro-row" className="mt-2">
      <ProRow onOpenEditor={openEditor} autoFocus={autoFocus} />
    </div>
  );
}
