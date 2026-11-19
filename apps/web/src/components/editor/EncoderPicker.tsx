import React, { useEffect, useState } from "react";
import {
  describeBrowserEncoderOptions,
  describeEncoderOptions,
  probeWebCodecsEncoderSupport,
  type EncoderChoice,
  type EncoderOption,
  type WebCodecsEncoderSupport,
} from "@openreel/core";
import { Label, RadioGroup, RadioGroupItem, cn } from "@openreel/ui";

interface EncoderPickerProps {
  codec: string;
  width: number;
  height: number;
  frameRate: number;
  value: EncoderChoice;
  onChange: (choice: EncoderChoice) => void;
  /** True while the saved choice cannot run on this machine (Export should be blocked until the user picks another). */
  onBlockedChange?: (blocked: boolean) => void;
}

const isDesktop = (): boolean => typeof window !== "undefined" && window.openreel?.platform === "desktop";

/**
 * Encoder choice for H.264 / H.265 / AV1: Auto, Hardware or Software. The desktop asks the ffmpeg
 * sidecar which encoders actually opened on this machine (VideoToolbox, NVENC, Quick Sync, AMF);
 * the browser asks WebCodecs. A choice the machine cannot run is disabled with the reason shown.
 */
export const EncoderPicker: React.FC<EncoderPickerProps> = ({ codec, width, height, frameRate, value, onChange, onBlockedChange }) => {
  const desktop = isDesktop();
  const [encoders, setEncoders] = useState<string[] | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [web, setWeb] = useState<WebCodecsEncoderSupport | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void (window.openreel?.probeHardware?.() ?? Promise.resolve(null))
      .catch(() => null)
      .then((info) => {
        if (!active) return;
        setEncoders(info?.encoders ?? []);
        setPlatform(info?.platform ?? "");
      });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    if (desktop) return;
    let active = true;
    // Keep the previous answer while a new probe runs, so an in-flight probe never reads as "unavailable".
    void probeWebCodecsEncoderSupport(codec, width, height, frameRate).then((support) => {
      if (active) setWeb(support);
    });
    return () => {
      active = false;
    };
  }, [desktop, codec, width, height, frameRate]);

  const options: EncoderOption[] = desktop
    ? describeEncoderOptions({ codec, platform, available: encoders })
    : describeBrowserEncoderOptions(web);

  // The choice is never changed behind the user's back. Once a probe has answered, a choice the
  // machine cannot run is shown as such and Export is blocked until the user picks another.
  const probed = desktop ? encoders !== null : web !== null;
  const selectedOption = options.find((option) => option.choice === value);
  const blocked = probed && value !== "auto" && !!selectedOption && !selectedOption.available;
  useEffect(() => {
    onBlockedChange?.(blocked);
    return () => onBlockedChange?.(false);
  }, [blocked, onBlockedChange]);

  return (
    <div className="col-span-2 border-t border-border pt-4" data-testid="encoder-picker">
      <span className="mb-2 block text-[11px] font-bold text-fg-2">Encoder</span>
      <RadioGroup aria-label="Encoder" value={value} onValueChange={(next) => onChange(next as EncoderChoice)} className="grid grid-cols-3 gap-2">
        {options.map((option) => (
          <Label
            key={option.choice}
            data-testid={`encoder-${option.choice}`}
            data-available={option.available ? "true" : "false"}
            data-selected={value === option.choice ? "true" : undefined}
            htmlFor={`export-encoder-${option.choice}`}
            className={cn(
              "relative block min-h-[58px] rounded-md border border-border bg-bg-1 px-3 py-2.5 text-left text-fg transition-colors focus-within:ring-2 focus-within:ring-ring",
              option.available ? "cursor-pointer hover:bg-bg-2" : "cursor-not-allowed opacity-60",
              value === option.choice && "border-accent bg-selected shadow-[0_0_0_1px_var(--accent)]",
            )}
          >
            <RadioGroupItem id={`export-encoder-${option.choice}`} value={option.choice} disabled={!option.available} aria-label={option.label} className="sr-only" />
            <span className="block text-[11px] font-semibold">{option.label}</span>
            <span className="mt-0.5 block text-[9px] leading-3 text-fg-muted">{option.detail}</span>
          </Label>
        ))}
      </RadioGroup>
      {blocked && selectedOption && (
        <p role="alert" data-testid="encoder-unavailable-note" className="mt-2 text-[11px] text-error">
          {selectedOption.label} is not available here: {selectedOption.detail}. Choose{" "}
          <button type="button" className="underline" onClick={() => onChange("auto")}>
            Auto
          </button>{" "}
          or another encoder to export.
        </p>
      )}
    </div>
  );
};
