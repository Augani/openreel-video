import { useEffect, useState } from "react";

function age(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes === 0) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** One minute timer for the visible panel, with no work for undated legacy records. */
export function useChangeClock(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, [enabled]);
  return now;
}

export function validChangeTimestamp(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 8.64e15;
}

export function ChangeAge({ timestamp, now }: { timestamp: number | undefined; now: number }) {
  if (!validChangeTimestamp(timestamp)) return null;
  const date = new Date(timestamp);
  return <><span aria-hidden="true">·</span><time dateTime={date.toISOString()} title={date.toLocaleString()}>{age(timestamp, now)}</time></>;
}
