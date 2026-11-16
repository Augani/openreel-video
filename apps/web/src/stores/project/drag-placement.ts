/**
 * While a timeline clip drag is in progress its live moves may overlap other
 * clips on the destination track: the drop resolves the overlap (overwrite,
 * insert or copy). Outside a drag, occupied intervals stack onto a new track.
 */
let dragResolvesOverlap = false;

export function setDragResolvesOverlap(active: boolean): void {
  dragResolvesOverlap = active;
}

export function dragPlacementPolicy(): "overlap" | "stack-above" {
  return dragResolvesOverlap ? "overlap" : "stack-above";
}
