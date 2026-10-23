/**
 * One line under the AI Editor composer when it runs on Director's Eyes points: the price per model
 * call (director_prices.editor_ai_call, editable by the admin) and that one request can take several.
 */
import React, { useEffect, useState } from "react";
import { useAIConnectionStore } from "../stores/ai-connection-store";
import { isHawshAI } from "./ai";
import { hawshClient, useHawshStore } from "./session";

const DEFAULT_PRICE = 0.1;
let cached: number | null = null;

/** Arabic count of points: "0.1 نقطة". */
export function priceNote(points: number): string {
  const n = Number(points.toFixed(2));
  return `${n} نقطة لكل خطوة من رصيد عيون المخرج — الطلب الواحد قد يحتاج عدة خطوات.`;
}

export const AIPriceNote: React.FC = () => {
  const onHawsh = useAIConnectionStore((s) => isHawshAI(s.baseUrl));
  const ready = useHawshStore((s) => s.status === "ready");
  const [price, setPrice] = useState<number>(cached ?? DEFAULT_PRICE);

  useEffect(() => {
    if (!onHawsh || !ready || cached !== null) return;
    const c = hawshClient();
    if (!c) return;
    void c.from("director_prices").select("value").eq("key", "editor_ai_call").maybeSingle().then(({ data }) => {
      const v = Number((data as { value?: unknown } | null)?.value);
      if (Number.isFinite(v) && v >= 0) { cached = v; setPrice(v); }
    });
  }, [onHawsh, ready]);

  if (!onHawsh || !ready) return null;
  return <div className="mt-0.5 px-1 text-[10px] text-fg-muted">{priceNote(price)}</div>;
};
