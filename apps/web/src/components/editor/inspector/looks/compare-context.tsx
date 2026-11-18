import React, { createContext, useContext, useMemo, useState } from "react";

interface LookCompare {
  compare: boolean;
  setCompare: (value: boolean) => void;
}

const LookCompareContext = createContext<LookCompare | null>(null);

/** One before / after switch for every card section of the Color tab (looks, LUTs, saved looks, white balance). */
export const LookCompareProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [compare, setCompare] = useState(false);
  const value = useMemo(() => ({ compare, setCompare }), [compare]);
  return <LookCompareContext.Provider value={value}>{children}</LookCompareContext.Provider>;
};

/** The shared switch; outside a provider each caller keeps its own. */
export function useLookCompare(): LookCompare {
  const shared = useContext(LookCompareContext);
  const [local, setLocal] = useState(false);
  return shared ?? { compare: local, setCompare: setLocal };
}

/** The toggle button. Every instance drives the same state, so the sections stay in step. */
export const CompareToggle: React.FC<{ testId: string }> = ({ testId }) => {
  const { compare, setCompare } = useLookCompare();
  return (
    <button
      type="button"
      aria-pressed={compare}
      aria-label="Compare before and after"
      title="Split every card into the clip as it is now (left) and with the change applied (right)"
      data-testid={testId}
      onClick={() => setCompare(!compare)}
      className={`h-5 shrink-0 rounded border px-1.5 text-[9px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        compare ? "border-primary bg-primary/15 text-fg" : "border-border bg-bg-1 text-fg-2 hover:text-fg"
      }`}
    >
      Before / after
    </button>
  );
};
