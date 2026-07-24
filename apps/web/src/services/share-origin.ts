export function shareBaseOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridge = window.openreel;
  if (bridge?.platform === "desktop") return bridge.publicOrigin;
  return `${window.location.origin}${window.location.pathname}`;
}
