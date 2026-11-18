import type { TextStyle, Transform } from "@openreel/core";

/** Project-space bounds, using the same baselines and alignment as TitleEngine. */
export function textSelectionLayout(
  measuredWidth: number,
  lineCount: number,
  lineHeight: number,
  style: Pick<
    TextStyle,
    "textAlign" | "verticalAlign" | "backgroundColor" | "strokeWidth"
  > & Partial<Pick<TextStyle, "letterSpacing">>,
  transform: Pick<Transform, "scale" | "rotation">,
) {
  const height = Math.max(1, lineCount) * lineHeight;
  const textLeft =
    style.textAlign === "center"
      ? -measuredWidth / 2
      : style.textAlign === "right"
        ? -measuredWidth
        : 0;
  const firstBaseline =
    style.verticalAlign === "top"
      ? 0
      : style.verticalAlign === "bottom"
        ? -height
        : -height / 2 + lineHeight / 2;
  const stroke = (style.strokeWidth ?? 0) / 2;
  // Canvas letter-spacing is added after every glyph, so negative tracking leaves the last glyph's ink hanging that far
  // past the measured advance width. Cover it.
  const tracking = Math.max(0, -(style.letterSpacing ?? 0));
  const overhang = tracking;
  let left = textLeft - stroke - overhang;
  let right = textLeft + measuredWidth + stroke + overhang;
  let top = firstBaseline - lineHeight / 2 - stroke;
  let bottom = top + height + stroke * 2;
  if (style.backgroundColor && style.backgroundColor !== "transparent") {
    // TitleEngine draws both the block background and individual line boxes.
    left = Math.min(left, -measuredWidth / 2 - 10);
    right = Math.max(right, measuredWidth / 2 + 10);
    top = Math.min(top, -height / 2);
    bottom = Math.max(bottom, height / 2);
  }
  const xs = [left * transform.scale.x, right * transform.scale.x];
  const ys = [top * transform.scale.y, bottom * transform.scale.y];
  left = Math.min(...xs);
  right = Math.max(...xs);
  top = Math.min(...ys);
  bottom = Math.max(...ys);
  const radians = (transform.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const corners = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([x, y]) => ({ x: x * cos - y * sin, y: x * sin + y * cos }));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    rotated: {
      left: Math.min(...corners.map((point) => point.x)),
      right: Math.max(...corners.map((point) => point.x)),
      top: Math.min(...corners.map((point) => point.y)),
      bottom: Math.max(...corners.map((point) => point.y)),
    },
  };
}
