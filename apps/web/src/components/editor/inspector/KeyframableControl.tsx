import * as React from "react";
import { LabeledSlider, type LabeledSliderProps } from "@openreel/ui";
import { Diamond } from "lucide-react";
import { useKeyframable } from "./use-keyframable";

export interface KeyframableControlProps extends LabeledSliderProps {
  clipId?: string;
  property?: string;
  displayScale?: number;
}

export const KeyframableControl: React.FC<KeyframableControlProps> = ({
  clipId, property, displayScale = 1, value, onChange, label, ...rest
}) => {
  if (!clipId || !property) {
    return <LabeledSlider label={label} value={value} onChange={onChange} {...rest} />;
  }
  return (
    <Keyframed clipId={clipId} property={property} displayScale={displayScale} value={value} onChange={onChange} label={label} {...rest} />
  );
};

const Keyframed: React.FC<
  { clipId: string; property: string; displayScale: number } & LabeledSliderProps
> = ({ clipId, property, displayScale, value, onChange, label, ...rest }) => {
  const { isAnimated, valueAtPlayhead, upsert, enable, disable } = useKeyframable(clipId, property, displayScale);
  const displayValue = isAnimated && valueAtPlayhead !== undefined ? valueAtPlayhead * displayScale : value;

  const handleChange = (next: number) => {
    if (isAnimated) upsert(next / displayScale);
    else onChange(next);
  };
  const toggle = () => {
    if (isAnimated) disable();
    else enable(value / displayScale);
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`keyframe ${label}`}
        aria-pressed={isAnimated}
        onClick={toggle}
        className={isAnimated ? "text-accent" : "text-fg-3 hover:text-fg"}
      >
        <Diamond size={12} fill={isAnimated ? "currentColor" : "none"} />
      </button>
      <div className="flex-1">
        <LabeledSlider label={label} value={displayValue} onChange={handleChange} {...rest} />
      </div>
    </div>
  );
};
