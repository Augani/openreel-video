import { useSyncExternalStore } from "react";
import { getMemoryGovernor, type MemoryPolicy } from "@openreel/core";

/** The memory governor's current policy; re-renders when the pressure level changes. */
export function useMemoryPolicy(): MemoryPolicy {
  return useSyncExternalStore(
    (onChange) => getMemoryGovernor().subscribe(onChange),
    () => getMemoryGovernor().policy,
    () => getMemoryGovernor().policy,
  );
}
