import { v4 as uuidv4 } from "uuid";
import type { TextScroll } from "@openreel/core";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@openreel/ui";
import { ScrollModeGlyph } from "./motion-glyphs";
import { useProjectStore } from "../../../stores/project-store";

type Mode = "none" | "roll" | "crawl";

const DIRECTIONS: Record<"roll" | "crawl", ReadonlyArray<{ value: NonNullable<TextScroll["direction"]>; label: string }>> = {
  roll: [{ value: "up", label: "Up (credits)" }, { value: "down", label: "Down" }],
  crawl: [{ value: "left", label: "Left (ticker)" }, { value: "right", label: "Right" }],
};

/** Roll (vertical) / crawl (horizontal) scrolling over the clip's duration. */
export function TextScrollSection({ clipId }: { clipId: string }) {
  const scroll = useProjectStore((state) => state.project.textClips?.find((c) => c.id === clipId)?.scroll);
  const mode: Mode = scroll?.mode ?? "none";

  const commit = (next: TextScroll | null) =>
    useProjectStore.getState().executeAction({
      type: "text/update",
      id: uuidv4(),
      timestamp: Date.now(),
      params: next ? { clipId, updates: { scroll: next } } : { clipId, updates: {}, unset: ["scroll"] },
    });

  return (
    <div className="space-y-3" data-text-scroll>
      <div role="radiogroup" aria-label="Scroll mode" className="grid grid-cols-3 gap-1.5">
        {(["none", "roll", "crawl"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-label={value === "none" ? "No scroll" : value === "roll" ? "Roll" : "Crawl"}
            onClick={() => {
              if (value === "none") void commit(null);
              else if (mode !== value) {
                void commit({ mode: value, startOffscreen: scroll?.startOffscreen ?? true, endOffscreen: scroll?.endOffscreen ?? true });
              }
            }}
            className={`flex flex-col items-center gap-1 rounded-[7px] border px-1.5 py-2 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
              mode === value ? "border-accent bg-selected text-fg" : "border-border bg-bg-1 text-fg-2 hover:bg-bg-2 hover:text-fg"
            }`}
          >
            <ScrollModeGlyph
              mode={value}
              direction={mode === value ? scroll?.direction ?? DIRECTIONS[value === "none" ? "roll" : value][0].value : undefined}
              className={`!h-8 !w-full ${mode === value ? "text-accent" : ""}`}
            />
            {value === "none" ? "None" : value === "roll" ? "Roll" : "Crawl"}
          </button>
        ))}
      </div>
      {scroll && (
        <>
          <Label className="flex items-center justify-between gap-2 text-xs font-normal text-fg-2">
            <span>Direction</span>
            <Select value={scroll.direction ?? DIRECTIONS[scroll.mode][0].value}
              onValueChange={(direction) => void commit({ ...scroll, direction: direction as TextScroll["direction"] })}>
              <SelectTrigger aria-label="Scroll direction" className="h-7 w-32 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DIRECTIONS[scroll.mode].map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Label>
          <Label className="flex items-center justify-between gap-2 text-xs font-normal text-fg-2">
            <span>Start off-screen</span>
            <Switch aria-label="Start off-screen" checked={scroll.startOffscreen}
              onCheckedChange={(startOffscreen) => void commit({ ...scroll, startOffscreen })} />
          </Label>
          <Label className="flex items-center justify-between gap-2 text-xs font-normal text-fg-2">
            <span>End off-screen</span>
            <Switch aria-label="End off-screen" checked={scroll.endOffscreen}
              onCheckedChange={(endOffscreen) => void commit({ ...scroll, endOffscreen })} />
          </Label>
          <p className="text-[10px] text-fg-3">Moves across the whole clip duration. Not applied to 3D titles.</p>
        </>
      )}
    </div>
  );
}
