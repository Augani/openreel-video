/**
 * Radix modal layers (Dialog, DropdownMenu, ContextMenu, Select...) set
 * `pointer-events: none` on <body> while open and restore it on close. When a
 * dialog is opened from a menu item, the menu's close and the dialog's open
 * overlap; on slow machines the restore can be skipped, leaving the whole page
 * unclickable after both have closed (every click hits <html>).
 */

/** Open Radix layers that legitimately hold the body pointer lock. */
const OPEN_MODAL_LAYERS = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(",")

/**
 * Clears a leftover body pointer lock when no modal layer is open.
 * Returns true when it released one.
 */
export function releaseStaleBodyPointerLock(doc: Document = document): boolean {
  const body = doc.body
  if (!body || body.style.pointerEvents !== "none") return false
  if (doc.querySelector(OPEN_MODAL_LAYERS)) return false
  body.style.pointerEvents = ""
  if (body.getAttribute("style") === "") body.removeAttribute("style")
  return true
}

/** Close animations in the UI kit run up to 200 ms; check after they finish. */
export const POINTER_LOCK_CHECK_DELAYS_MS = [0, 250] as const

/** Schedules releaseStaleBodyPointerLock after a modal layer closes. */
export function scheduleStaleBodyPointerLockRelease(doc: Document = document): void {
  for (const delay of POINTER_LOCK_CHECK_DELAYS_MS) {
    setTimeout(() => releaseStaleBodyPointerLock(doc), delay)
  }
}
