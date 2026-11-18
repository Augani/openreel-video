import { createContext, useContext } from "react";
import { useUIStore, type SelectionItem } from "../../../../stores/ui-store";

const InspectorSelectionContext = createContext<SelectionItem[] | null>(null);

/** Supplied by the inspector with its (deferred) selection so controls render against the same value as their tab. */
export const InspectorSelectionProvider = InspectorSelectionContext.Provider;

/**
 * The selection an inspector control scopes its edit state to. Inside the inspector it is the
 * inspector's own deferred selection: a live store subscription here re-rendered every slider
 * and number field at urgent priority on each click, ahead of the paint of the new selection.
 * Outside an inspector (tests, other panels) it falls back to the live selection.
 */
export function useInspectorSelection(): SelectionItem[] {
  const provided = useContext(InspectorSelectionContext);
  // A constant selector result while provided keeps the store subscription from re-rendering.
  const live = useUIStore((state) => (provided ? null : state.selectedItems));
  return provided ?? live ?? [];
}
