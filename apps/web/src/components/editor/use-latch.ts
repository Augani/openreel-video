import { useState } from "react";

/** True from the first render in which `value` is true onwards (mount-on-first-use for lazily loaded dialogs). */
export function useLatch(value: boolean): boolean {
  const [latched, setLatched] = useState(value);
  if (value && !latched) setLatched(true);
  return latched || value;
}
