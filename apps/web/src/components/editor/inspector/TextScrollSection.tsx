import { v4 as uuidv4 } from "uuid";
import type { TextScroll } from "@openreel/core";
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@openreel/ui";
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
      <Label className="flex items-center justify-between gap-2 text-xs font-normal text-fg-2">
        <span>Scroll</span>
        <Select value={mode} onValueChange={(value) => {
          if (value === "none") void commit(null);
          else void commit({ mode: value as "roll" | "crawl", startOffscreen: scroll?.startOffscreen ?? true, endOffscreen: scroll?.endOffscreen ?? true });
        }}>
          <SelectTrigger aria-label="Scroll mode" className="h-7 w-32 rounded-[5px] bg-bg-2 px-2 py-1 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="roll">Roll</SelectItem>
            <SelectItem value="crawl">Crawl</SelectItem>
          </SelectContent>
        </Select>
      </Label>
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
